import type { Request, Response } from "express";
import httpStatus from "http-status";
import type { ShipmentStatus } from "../../../generated/prisma/enums";
import config from "../../config";
import { prisma } from "../../lib/prisma";
import { qstashReceiver } from "../../lib/qstash";
import { AppError } from "../../utils/AppError";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import { STATUS_SEQUENCE } from "./shipment.constant";
import { ShipmentService } from "./shipment.service";
import { processSimulatedStatusUpdate } from "./shipment.simulator";

const createShipment = catchAsync(async (req: Request, res: Response) => {
	const customerId = req.user?.userId;

	if (!customerId) {
		throw new AppError(httpStatus.UNAUTHORIZED, "User not authenticated");
	}

	const result = await ShipmentService.createShipment(customerId, req.body);

	sendResponse(res, {
		statusCode: httpStatus.CREATED,
		success: true,
		message: "Shipment created successfully",
		data: result,
	});
});

const getAllShipments = catchAsync(async (req: Request, res: Response) => {
	const currentUser = req.user;

	if (!currentUser) {
		throw new AppError(httpStatus.UNAUTHORIZED, "User not authenticated");
	}

	const result = await ShipmentService.getAllShipments(currentUser, req.query);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Shipments retrieved successfully",
		meta: result.meta,
		data: result.data,
	});
});

const getShipmentById = catchAsync(async (req: Request, res: Response) => {
	const currentUser = req.user;
	const { id } = req.params;

	if (!currentUser) {
		throw new AppError(httpStatus.UNAUTHORIZED, "User not authenticated");
	}

	const result = await ShipmentService.getShipmentById(
		currentUser,
		id as string,
	);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Shipment retrieved successfully",
		data: result,
	});
});

const trackShipment = catchAsync(async (req: Request, res: Response) => {
	const currentUser = req.user;
	const { trackingNumber } = req.params;

	if (!currentUser) {
		throw new AppError(httpStatus.UNAUTHORIZED, "User not authenticated");
	}

	const result = await ShipmentService.getShipmentByTrackingNumber(
		currentUser,
		trackingNumber as string,
	);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Shipment tracking info retrieved successfully",
		data: result,
	});
});

const assignCourier = catchAsync(async (req: Request, res: Response) => {
	const currentUser = req.user;
	const { id } = req.params;

	if (!currentUser) {
		throw new AppError(httpStatus.UNAUTHORIZED, "User not authenticated");
	}

	const result = await ShipmentService.assignCourier(
		currentUser,
		id as string,
		req.body,
	);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Courier assigned to shipment successfully",
		data: result,
	});
});

const getAvailableCouriersForShipment = catchAsync(
	async (req: Request, res: Response) => {
		const currentUser = req.user;
		const { id } = req.params;

		if (!currentUser) {
			throw new AppError(httpStatus.UNAUTHORIZED, "User not authenticated");
		}

		const result = await ShipmentService.getAvailableCouriersForShipment(
			currentUser,
			id as string,
		);

		sendResponse(res, {
			statusCode: httpStatus.OK,
			success: true,
			message: "Available couriers retrieved successfully",
			data: result,
		});
	},
);

const simulateStatusUpdate = catchAsync(async (req: Request, res: Response) => {
	const signature = req.headers["upstash-signature"] as string | undefined;

	if (signature && config.qstash_current_signing_key) {
		const rawBody =
			(req as Request & { rawBody?: Buffer }).rawBody?.toString("utf-8") ||
			JSON.stringify(req.body);
		try {
			await qstashReceiver.verify({
				signature,
				body: rawBody,
			});
		} catch (_err) {
			throw new AppError(
				httpStatus.UNAUTHORIZED,
				"Invalid QStash webhook signature",
			);
		}
	}

	const { shipmentId, nextStatus } = req.body;

	if (!shipmentId || !nextStatus) {
		throw new AppError(
			httpStatus.BAD_REQUEST,
			"shipmentId and nextStatus are required in request body",
		);
	}

	// Fast idempotency check before doing any processing
	const [existingEvent, shipment] = await Promise.all([
		prisma.shipmentEvent.findFirst({
			where: {
				shipmentId: shipmentId as string,
				status: nextStatus as ShipmentStatus,
			},
		}),
		prisma.shipment.findUnique({
			where: { id: shipmentId as string },
			select: { status: true, trackingNumber: true },
		}),
	]);

	if (
		existingEvent ||
		(shipment &&
			STATUS_SEQUENCE[shipment.status] >=
				STATUS_SEQUENCE[nextStatus as ShipmentStatus])
	) {
		console.log(
			`[Webhook:Guard] 🛑 Idempotent call: Event for '${nextStatus}' already processed for Shipment [${shipment?.trackingNumber || shipmentId}]. Skipping DB update.`,
		);
		return sendResponse(res, {
			statusCode: httpStatus.OK,
			success: true,
			message: `Event for ${nextStatus} has already been processed (idempotent). Database untouched.`,
			data: shipment,
		});
	}

	const result = await processSimulatedStatusUpdate(
		shipmentId as string,
		nextStatus as ShipmentStatus,
	);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: `Simulated status updated to ${nextStatus}`,
		data: result,
	});
});

export const ShipmentController = {
	createShipment,
	getAllShipments,
	getShipmentById,
	trackShipment,
	assignCourier,
	getAvailableCouriersForShipment,
	simulateStatusUpdate,
};
