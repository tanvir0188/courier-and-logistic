import type { Request, Response } from "express";
import httpStatus from "http-status";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import { ZoneService } from "./zone.service";

const createZone = catchAsync(async (req: Request, res: Response) => {
	const result = await ZoneService.createZone(req.body);

	sendResponse(res, {
		statusCode: httpStatus.CREATED,
		success: true,
		message: "Zone created successfully",
		data: result,
	});
});

const getAllZones = catchAsync(async (req: Request, res: Response) => {
	const result = await ZoneService.getAllZones(req.query);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Zones retrieved successfully",
		meta: result.meta,
		data: result.data,
	});
});

const getZoneById = catchAsync(async (req: Request, res: Response) => {
	const { id } = req.params;
	const result = await ZoneService.getZoneById(id as string);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Zone retrieved successfully",
		data: result,
	});
});

const updateZone = catchAsync(async (req: Request, res: Response) => {
	const { id } = req.params;
	const result = await ZoneService.updateZone(id as string, req.body);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Zone updated successfully",
		data: result,
	});
});

const deleteZone = catchAsync(async (req: Request, res: Response) => {
	const { id } = req.params;
	const result = await ZoneService.deleteZone(id as string);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Zone deleted successfully",
		data: result,
	});
});

export const ZoneController = {
	createZone,
	getAllZones,
	getZoneById,
	updateZone,
	deleteZone,
};
