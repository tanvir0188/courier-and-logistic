import type { Request, Response } from "express";
import httpStatus from "http-status";
import { AppError } from "../../utils/AppError";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import { PaymentService } from "./payment.service";

interface RequestWithRawBody extends Request {
	rawBody?: Buffer;
}

const createCheckoutSession = catchAsync(
	async (req: Request, res: Response) => {
		const currentUser = req.user;

		if (!currentUser) {
			throw new AppError(httpStatus.UNAUTHORIZED, "User not authenticated");
		}

		const result = await PaymentService.createCheckoutSession(
			currentUser,
			req.body,
		);

		sendResponse(res, {
			statusCode: httpStatus.OK,
			success: true,
			message: "Stripe checkout session created successfully",
			data: result,
		});
	},
);

const handleStripeWebhook = catchAsync(
	async (req: RequestWithRawBody, res: Response) => {
		const signature = req.headers["stripe-signature"] as string | undefined;

		if (!signature) {
			throw new AppError(
				httpStatus.BAD_REQUEST,
				"Missing stripe-signature header",
			);
		}

		const rawBody = req.rawBody || (req.body as Buffer);

		if (!rawBody) {
			throw new AppError(
				httpStatus.BAD_REQUEST,
				"Missing raw body for webhook verification",
			);
		}

		const result = await PaymentService.handleStripeWebhook(rawBody, signature);

		res.status(httpStatus.OK).json(result);
	},
);

const verifyCheckoutSession = catchAsync(
	async (req: Request, res: Response) => {
		const currentUser = req.user;

		if (!currentUser) {
			throw new AppError(httpStatus.UNAUTHORIZED, "User not authenticated");
		}

		const { sessionId } = req.body;

		const result = await PaymentService.verifyCheckoutSession(
			currentUser,
			sessionId as string,
		);

		sendResponse(res, {
			statusCode: httpStatus.OK,
			success: true,
			message: result.message,
			data: result,
		});
	},
);

const getPaymentByShipmentId = catchAsync(
	async (req: Request, res: Response) => {
		const currentUser = req.user;
		const { shipmentId } = req.params;

		if (!currentUser) {
			throw new AppError(httpStatus.UNAUTHORIZED, "User not authenticated");
		}

		const result = await PaymentService.getPaymentByShipmentId(
			currentUser,
			shipmentId as string,
		);

		sendResponse(res, {
			statusCode: httpStatus.OK,
			success: true,
			message: "Payment retrieved successfully",
			data: result,
		});
	},
);

const getAllPayments = catchAsync(async (req: Request, res: Response) => {
	const currentUser = req.user;

	if (!currentUser) {
		throw new AppError(httpStatus.UNAUTHORIZED, "User not authenticated");
	}

	const result = await PaymentService.getAllPayments(currentUser, req.query);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Payments retrieved successfully",
		meta: result.meta,
		data: result.data,
	});
});

export const PaymentController = {
	createCheckoutSession,
	handleStripeWebhook,
	verifyCheckoutSession,
	getPaymentByShipmentId,
	getAllPayments,
};
