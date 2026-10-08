import type { Request, Response } from "express";
import httpStatus from "http-status";
import { AppError } from "../../utils/AppError";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import { UserServices } from "./user.service";
import { Role } from "../../../generated/prisma/enums";

const updateProfile = catchAsync(async (req: Request, res: Response) => {
	const userId = req.user?.userId;

	if (!userId) {
		throw new AppError(httpStatus.UNAUTHORIZED, "User not authenticated");
	}

	let body = req.body || {};
	if (typeof body.data === "string") {
		try {
			body = JSON.parse(body.data);
		} catch {
			// keep parsed body as fallback
		}
	}

	const payload = {
		name: body.name,
		phone: body.phone,
		profilePic: body.profilePic,
	};

	const result = await UserServices.updateProfile(
		userId,
		payload,
		req.file?.buffer,
	);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Profile updated successfully",
		data: result,
	});
});

const getUsers = catchAsync(async (req: Request, res: Response) => {
	const userRole = req.user?.role;

	if (userRole !== Role.ADMIN) {
		throw new AppError(httpStatus.FORBIDDEN, "Access denied");
	}
	const result = await UserServices.getAllUsers(req.query);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Users retrieved successfully",
		meta: result.meta,
		data: result.data,
	});
});

export const UserController = {
	updateProfile,
	getUsers,
};
