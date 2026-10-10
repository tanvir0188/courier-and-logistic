import httpStatus from "http-status";
import type Stripe from "stripe";
import type { Prisma } from "../../../generated/prisma/client";
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
import { STATUS_SEQUENCE } from "../shipment/shipment.constant";
import type {
	ICreateCheckoutSessionPayload,
	IPaymentFilterRequest,
} from "./payment.interface";

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
	// 1. Fast idempotent check: If already SUCCESS, or PAYMENT_CONFIRMED event exists, or already past this status, return immediately without opening a transaction
	const [existingPayment, existingEvent, existingShipment] = await Promise.all([
		prisma.payment.findUnique({
			where: { shipmentId },
		}),
		prisma.shipmentEvent.findFirst({
			where: {
				shipmentId,
				status: ShipmentStatus.PAYMENT_CONFIRMED,
			},
		}),
		prisma.shipment.findUnique({
			where: { id: shipmentId },
			select: { status: true },
		}),
	]);

	if (
		existingPayment?.status === PaymentStatus.SUCCESS ||
		existingEvent ||
		(existingShipment &&
			STATUS_SEQUENCE[existingShipment.status] >=
				STATUS_SEQUENCE[ShipmentStatus.PAYMENT_CONFIRMED])
	) {
		console.log(
			`[Payment:Idempotency] Shipment [${shipmentId}] payment confirmed event already recorded. Skipping DB update.`,
		);
		return await prisma.shipment.findUnique({
			where: { id: shipmentId },
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
	}

	try {
		return await prisma.$transaction(
			async (tx) => {
				const [currentPayment, existingEventInTx, currentShipmentInTx] =
					await Promise.all([
						tx.payment.findUnique({ where: { shipmentId } }),
						tx.shipmentEvent.findFirst({
							where: {
								shipmentId,
								status: ShipmentStatus.PAYMENT_CONFIRMED,
							},
						}),
						tx.shipment.findUnique({ where: { id: shipmentId } }),
					]);

				// Double-check inside transaction in case it was marked SUCCESS or event created concurrently
				if (
					currentPayment?.status === PaymentStatus.SUCCESS ||
					existingEventInTx ||
					(currentShipmentInTx &&
						STATUS_SEQUENCE[currentShipmentInTx.status] >=
							STATUS_SEQUENCE[ShipmentStatus.PAYMENT_CONFIRMED])
				) {
					console.log(
						`[Payment:Idempotency:Tx] Shipment [${shipmentId}] already confirmed or event exists. Skipping DB update.`,
					);
					return await tx.shipment.findUnique({
						where: { id: shipmentId },
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
				}

				// Update payment record to SUCCESS
				await tx.payment.update({
					where: { shipmentId },
					data: {
						status: PaymentStatus.SUCCESS,
						transactionId: transactionId || currentPayment?.transactionId,
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
			},
			{
				maxWait: 10000, // 10 seconds to acquire connection
				timeout: 20000, // 20 seconds for transaction execution
			},
		);
	} catch (error) {
		// If transaction failed due to timeout or concurrency conflict, check if another process already confirmed it
		const verifiedPayment = await prisma.payment.findUnique({
			where: { shipmentId },
		});

		if (verifiedPayment?.status === PaymentStatus.SUCCESS) {
			return await prisma.shipment.findUnique({
				where: { id: shipmentId },
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
		}

		throw error;
	}
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

	if (
		event.type === "checkout.session.completed" ||
		event.type === "checkout.session.async_payment_succeeded"
	) {
		const session = event.data.object as Stripe.Checkout.Session;
		const shipmentId =
			session.metadata?.shipmentId ||
			(session.client_reference_id as string | undefined);

		if (shipmentId && session.payment_status === "paid") {
			const transactionId =
				typeof session.payment_intent === "string"
					? session.payment_intent
					: undefined;

			try {
				await confirmPaymentSuccess(shipmentId, transactionId, session);
			} catch (_confirmError) {
				// Concurrency resilience: Check if shipment payment is already marked SUCCESS
				const checkPayment = await prisma.payment.findUnique({
					where: { shipmentId },
				});

				if (checkPayment?.status === PaymentStatus.SUCCESS) {
					return { received: true };
				}

				// Retry once after a brief delay if transient error
				try {
					await new Promise((resolve) => setTimeout(resolve, 1000));
					await confirmPaymentSuccess(shipmentId, transactionId, session);
				} catch (retryError) {
					const finalCheck = await prisma.payment.findUnique({
						where: { shipmentId },
					});
					if (finalCheck?.status === PaymentStatus.SUCCESS) {
						return { received: true };
					}
					throw retryError;
				}
			}
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

const getAllPayments = async (
	currentUser: RequestUser,
	filters: IPaymentFilterRequest = {},
) => {
	// 1. Authorization: Only Provider and Admin can access
	if (currentUser.role !== Role.ADMIN && currentUser.role !== Role.PROVIDER) {
		throw new AppError(
			httpStatus.FORBIDDEN,
			"Access denied. Only providers and admins can access payments.",
		);
	}

	const page = Math.max(1, Number(filters.page) || 1);
	const limit = Math.max(1, Number(filters.limit) || 10);
	const skip = (page - 1) * limit;
	const sortBy = filters.sortBy || "createdAt";
	const sortOrder = filters.sortOrder === "asc" ? "asc" : "desc";

	const where: Prisma.PaymentWhereInput = {};
	const andConditions: Prisma.PaymentWhereInput[] = [];

	// Role-based scoping: Providers can only see payments for their own shipments
	if (currentUser.role === Role.PROVIDER) {
		andConditions.push({
			shipment: {
				providerId: currentUser.userId,
			},
		});
	}

	if (filters.status) {
		andConditions.push({ status: filters.status });
	}

	if (filters.gateway) {
		andConditions.push({ gateway: filters.gateway });
	}

	if (filters.searchTerm) {
		const search = filters.searchTerm.trim();
		andConditions.push({
			OR: [
				{
					transactionId: {
						contains: search,
						mode: "insensitive",
					},
				},
				{
					shipmentId: {
						contains: search,
						mode: "insensitive",
					},
				},
				{
					shipment: {
						trackingNumber: {
							contains: search,
							mode: "insensitive",
						},
					},
				},
				{
					customer: {
						name: {
							contains: search,
							mode: "insensitive",
						},
					},
				},
				{
					customer: {
						email: {
							contains: search,
							mode: "insensitive",
						},
					},
				},
			],
		});
	} else {
		if (filters.transactionId) {
			andConditions.push({
				transactionId: {
					contains: filters.transactionId.trim(),
					mode: "insensitive",
				},
			});
		}

		if (filters.shipmentId) {
			andConditions.push({
				shipmentId: {
					contains: filters.shipmentId.trim(),
					mode: "insensitive",
				},
			});
		}

		if (filters.customerEmail) {
			andConditions.push({
				customer: {
					email: {
						contains: filters.customerEmail.trim(),
						mode: "insensitive",
					},
				},
			});
		}

		if (filters.customerName) {
			andConditions.push({
				customer: {
					name: {
						contains: filters.customerName.trim(),
						mode: "insensitive",
					},
				},
			});
		}
	}

	if (andConditions.length > 0) {
		where.AND = andConditions;
	}

	const [payments, total] = await Promise.all([
		prisma.payment.findMany({
			where,
			skip,
			take: limit,
			orderBy: {
				[sortBy]: sortOrder,
			},
			select: {
				id: true,
				transactionId: true,
				shipmentId: true,
				amount: true,
				status: true,
				gateway: true,
				paidAt: true,
				createdAt: true,
				customer: {
					select: {
						id: true,
						name: true,
						email: true,
						phone: true,
					},
				},
				shipment: {
					select: {
						id: true,
						trackingNumber: true,
						status: true,
						providerId: true,
					},
				},
			},
		}),
		prisma.payment.count({ where }),
	]);

	const formattedPayments = payments.map((payment) => ({
		id: payment.id,
		transactionId: payment.transactionId,
		shipmentId: payment.shipmentId,
		trackingNumber: payment.shipment?.trackingNumber,
		customerName: payment.customer.name,
		customerEmail: payment.customer.email,
		amount: Number(payment.amount),
		date: payment.paidAt || payment.createdAt,
		paidAt: payment.paidAt,
		createdAt: payment.createdAt,
		status: payment.status,
		gateway: payment.gateway,
		customer: payment.customer,
		shipment: payment.shipment,
	}));

	return {
		meta: {
			page,
			limit,
			total,
			totalPages: Math.ceil(total / limit),
		},
		data: formattedPayments,
	};
};

export const PaymentService = {
	createCheckoutSession,
	handleStripeWebhook,
	verifyCheckoutSession,
	getPaymentByShipmentId,
	confirmPaymentSuccess,
	getAllPayments,
};
