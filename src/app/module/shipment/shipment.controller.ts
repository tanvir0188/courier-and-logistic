import type { Request, Response } from "express";
import httpStatus from "http-status";
import { AppError } from "../../utils/AppError";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import { ShipmentService } from "./shipment.service";

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

export const ShipmentController = {
	createShipment,
	getAllShipments,
	getShipmentById,
	trackShipment,
	assignCourier,
	getAvailableCouriersForShipment,
};
