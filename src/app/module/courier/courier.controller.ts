import type { Request, Response } from "express";
import httpStatus from "http-status";
import { AppError } from "../../utils/AppError";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import { CourierService } from "./courier.service";

const createCourier = catchAsync(async (req: Request, res: Response) => {
	const providerId = req.user?.userId;

	if (!providerId) {
		throw new AppError(httpStatus.UNAUTHORIZED, "User not authenticated");
	}

	const result = await CourierService.createCourier(providerId, req.body);

	sendResponse(res, {
		statusCode: httpStatus.CREATED,
		success: true,
		message: "Courier created successfully",
		data: result,
	});
});

const getAllCouriers = catchAsync(async (req: Request, res: Response) => {
	const currentUser = req.user;

	if (!currentUser) {
		throw new AppError(httpStatus.UNAUTHORIZED, "User not authenticated");
	}

	const result = await CourierService.getAllCouriers(currentUser, req.query);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Couriers retrieved successfully",
		meta: result.meta,
		data: result.data,
	});
});

const getCourierById = catchAsync(async (req: Request, res: Response) => {
	const currentUser = req.user;
	const { id } = req.params;

	if (!currentUser) {
		throw new AppError(httpStatus.UNAUTHORIZED, "User not authenticated");
	}

	const result = await CourierService.getCourierById(
		currentUser,
		id as string,
	);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Courier retrieved successfully",
		data: result,
	});
});

const updateCourier = catchAsync(async (req: Request, res: Response) => {
	const currentUser = req.user;
	const { id } = req.params;

	if (!currentUser) {
		throw new AppError(httpStatus.UNAUTHORIZED, "User not authenticated");
	}

	const result = await CourierService.updateCourier(
		currentUser,
		id as string,
		req.body,
	);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Courier updated successfully",
		data: result,
	});
});

const deleteCourier = catchAsync(async (req: Request, res: Response) => {
	const currentUser = req.user;
	const { id } = req.params;

	if (!currentUser) {
		throw new AppError(httpStatus.UNAUTHORIZED, "User not authenticated");
	}

	const result = await CourierService.deleteCourier(
		currentUser,
		id as string,
	);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Courier deleted successfully",
		data: result,
	});
});

export const CourierController = {
	createCourier,
	getAllCouriers,
	getCourierById,
	updateCourier,
	deleteCourier,
};
