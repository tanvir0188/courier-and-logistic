import httpStatus from "http-status";
import type Stripe from "stripe";
import {
	PaymentGateway,
	PaymentStatus,
	Role,
	ShipmentStatus,
} from "../../../generated/prisma/enums";
import config from "../../config";
import { prisma } from "../../lib/prisma";
import { stripe } from "../../lib/stripe";
import type { RequestUser } from "../../middleware/checkAuth";
import { AppError } from "../../utils/AppError";
import type { ICreateCheckoutSessionPayload } from "./payment.interface";

const createCheckoutSession = async (
	currentUser: RequestUser,
	payload: ICreateCheckoutSessionPayload,
) => {
	// 1. Fetch shipment with zones and customer
	const shipment = await prisma.shipment.findUnique({
		where: { id: payload.shipmentId },
		include: {
			customer: true,
			senderZone: true,
			receiverZone: true,
			payment: true,
		},
	});

	if (!shipment) {
		throw new AppError(httpStatus.NOT_FOUND, "Shipment not found");
	}

	// 2. Authorization: Only the customer who created the shipment or an Admin can pay
	if (
		currentUser.role === Role.CUSTOMER &&
		shipment.customerId !== currentUser.userId
	) {
		throw new AppError(
			httpStatus.FORBIDDEN,
			"You do not have permission to pay for this shipment",
		);
	}

	// 3. Validation: Shipment must not be cancelled
	if (shipment.status === ShipmentStatus.CANCELLED) {
		throw new AppError(
			httpStatus.BAD_REQUEST,
			"Cannot make payment for a cancelled shipment",
		);
	}

	// 4. Validation: Check if already paid
	if (
		shipment.status === ShipmentStatus.PAYMENT_CONFIRMED ||
		shipment.payment?.status === PaymentStatus.SUCCESS
	) {
		throw new AppError(
			httpStatus.BAD_REQUEST,
			"Payment for this shipment has already been completed",
		);
	}

	// 5. Ensure a Payment record exists with PENDING status
	const payment = await prisma.payment.upsert({
		where: { shipmentId: shipment.id },
		create: {
			shipmentId: shipment.id,
			customerId: shipment.customerId,
			amount: shipment.totalAmount,
			gateway: PaymentGateway.STRIPE,
			status: PaymentStatus.PENDING,
		},
		update: {
			amount: shipment.totalAmount,
			gateway: PaymentGateway.STRIPE,
			status: PaymentStatus.PENDING,
		},
	});

	// 6. Create Stripe Checkout Session in payment mode
	const currency = (process.env.STRIPE_CURRENCY || "bdt").toLowerCase();
	const unitAmount = Math.round(Number(shipment.totalAmount) * 100);

	const successUrl =
		payload.successUrl ||
		`${config.frontend_url}/payment/success?session_id={CHECKOUT_SESSION_ID}&shipment_id=${shipment.id}`;
	const cancelUrl =
		payload.cancelUrl ||
		`${config.frontend_url}/payment/cancel?shipment_id=${shipment.id}`;

	const session = await stripe.checkout.sessions.create({
		mode: "payment",
		customer_email: shipment.customer.email,
		client_reference_id: shipment.id,
		metadata: {
			shipmentId: shipment.id,
			paymentId: payment.id,
			customerId: shipment.customerId,
			trackingNumber: shipment.trackingNumber,
		},
		line_items: [
			{
				price_data: {
					currency,
					product_data: {
						name: `Shipment Delivery [${shipment.trackingNumber}]`,
						description: `Route: ${shipment.senderZone.name} → ${shipment.receiverZone.name}`,
					},
					unit_amount: unitAmount,
				},
				quantity: 1,
			},
		],
		success_url: successUrl,
		cancel_url: cancelUrl,
	});

	// 7. Store checkout session id as gateway reference
	await prisma.payment.update({
		where: { id: payment.id },
		data: {
			gatewayReference: session.id,
		},
	});

	return {
		paymentId: payment.id,
		sessionId: session.id,
		paymentUrl: session.url,
	};
};

const confirmPaymentSuccess = async (
	shipmentId: string,
	transactionId?: string,
	sessionData?: unknown,
) => {
	return await prisma.$transaction(async (tx) => {
		const existingPayment = await tx.payment.findUnique({
			where: { shipmentId },
		});

		// If already marked as success, return current shipment
		if (existingPayment?.status === PaymentStatus.SUCCESS) {
			return await tx.shipment.findUnique({
				where: { id: shipmentId },
				include: { payment: true },
			});
		}

		// Update payment record to SUCCESS
		await tx.payment.update({
			where: { shipmentId },
			data: {
				status: PaymentStatus.SUCCESS,
				transactionId: transactionId || existingPayment?.transactionId,
				paidAt: new Date(),
				callbackData: (sessionData as object) || undefined,
			},
		});

		// Transition shipment status to PAYMENT_CONFIRMED and log event
		const updatedShipment = await tx.shipment.update({
			where: { id: shipmentId },
			data: {
				status: ShipmentStatus.PAYMENT_CONFIRMED,
				events: {
					create: {
						status: ShipmentStatus.PAYMENT_CONFIRMED,
						description: `Payment completed via Stripe. Transaction ID: ${transactionId || "N/A"}`,
					},
				},
			},
			include: {
				payment: true,
				senderZone: true,
				receiverZone: true,
				events: {
					orderBy: {
						createdAt: "asc",
					},
				},
			},
		});

		return updatedShipment;
	});
};

const handleStripeWebhook = async (rawBody: Buffer, signature: string) => {
	let event: Stripe.Event;
	try {
		event = stripe.webhooks.constructEvent(
			rawBody,
			signature,
			config.stripe_webhook_secret,
		);
	} catch (err) {
		const errorMessage =
			err instanceof Error ? err.message : "Invalid webhook signature";
		throw new AppError(
			httpStatus.BAD_REQUEST,
			`Webhook Signature Verification Failed: ${errorMessage}`,
		);
	}

	if (event.type === "checkout.session.completed") {
		const session = event.data.object as Stripe.Checkout.Session;
		const shipmentId =
			session.metadata?.shipmentId ||
			(session.client_reference_id as string | undefined);

		if (shipmentId && session.payment_status === "paid") {
			const transactionId =
				typeof session.payment_intent === "string"
					? session.payment_intent
					: undefined;
			await confirmPaymentSuccess(shipmentId, transactionId, session);
		}
	}

	return { received: true };
};

const verifyCheckoutSession = async (
	currentUser: RequestUser,
	sessionId: string,
) => {
	const session = await stripe.checkout.sessions.retrieve(sessionId);

	if (!session) {
		throw new AppError(httpStatus.NOT_FOUND, "Stripe session not found");
	}

	const shipmentId =
		session.metadata?.shipmentId ||
		(session.client_reference_id as string | undefined);

	if (!shipmentId) {
		throw new AppError(
			httpStatus.BAD_REQUEST,
			"No shipment ID associated with this checkout session",
		);
	}

	const shipment = await prisma.shipment.findUnique({
		where: { id: shipmentId },
		include: { payment: true },
	});

	if (!shipment) {
		throw new AppError(httpStatus.NOT_FOUND, "Associated shipment not found");
	}

	// Authorization check
	if (
		currentUser.role === Role.CUSTOMER &&
		shipment.customerId !== currentUser.userId
	) {
		throw new AppError(
			httpStatus.FORBIDDEN,
			"You do not have permission to verify this payment",
		);
	}

	if (
		currentUser.role === Role.PROVIDER &&
		shipment.providerId !== currentUser.userId
	) {
		throw new AppError(
			httpStatus.FORBIDDEN,
			"You do not have permission to verify this payment",
		);
	}

	if (session.payment_status === "paid") {
		const transactionId =
			typeof session.payment_intent === "string"
				? session.payment_intent
				: undefined;
		const updatedShipment = await confirmPaymentSuccess(
			shipmentId,
			transactionId,
			session,
		);

		return {
			success: true,
			status: PaymentStatus.SUCCESS,
			message: "Payment successfully verified and confirmed",
			shipment: updatedShipment,
		};
	}

	return {
		success: false,
		status: PaymentStatus.PENDING,
		message: `Payment not completed yet. Stripe status: ${session.payment_status}`,
	};
};

const getPaymentByShipmentId = async (
	currentUser: RequestUser,
	shipmentId: string,
) => {
	const shipment = await prisma.shipment.findUnique({
		where: { id: shipmentId },
		include: {
			payment: true,
		},
	});

	if (!shipment) {
		throw new AppError(httpStatus.NOT_FOUND, "Shipment not found");
	}

	if (
		currentUser.role === Role.CUSTOMER &&
		shipment.customerId !== currentUser.userId
	) {
		throw new AppError(
			httpStatus.FORBIDDEN,
			"You do not have permission to view this payment",
		);
	}

	if (
		currentUser.role === Role.PROVIDER &&
		shipment.providerId !== currentUser.userId
	) {
		throw new AppError(
			httpStatus.FORBIDDEN,
			"You do not have permission to view this payment",
		);
	}

	if (!shipment.payment) {
		throw new AppError(
			httpStatus.NOT_FOUND,
			"Payment record not found for this shipment",
		);
	}

	return shipment.payment;
};

export const PaymentService = {
	createCheckoutSession,
	handleStripeWebhook,
	verifyCheckoutSession,
	getPaymentByShipmentId,
	confirmPaymentSuccess,
};
