import type { Request, Response } from "express";
import httpStatus from "http-status";
import { Role } from "../../../generated/prisma/enums";
import { AppError } from "../../utils/AppError";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import { UserServices } from "./user.service";

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
	const currentUser = req.user;

	if (!currentUser) {
		throw new AppError(httpStatus.UNAUTHORIZED, "User not authenticated");
	}

	if (currentUser.role !== Role.ADMIN && currentUser.role !== Role.CUSTOMER) {
		throw new AppError(httpStatus.FORBIDDEN, "Access denied");
	}

	const result = await UserServices.getAllUsers(currentUser, req.query);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Users retrieved successfully",
		meta: result.meta,
		data: result.data,
	});
});

const toggleUserStatus = catchAsync(async (req: Request, res: Response) => {
	const currentUserId = req.user?.userId;
	const { id } = req.params;
	const { isActive } = req.body || {};

	if (!currentUserId) {
		throw new AppError(httpStatus.UNAUTHORIZED, "User not authenticated");
	}

	const explicitStatus = isActive !== undefined ? Boolean(isActive) : undefined;

	const result = await UserServices.toggleUserStatus(
		currentUserId,
		id as string,
		explicitStatus,
	);

	const message = result.isActive
		? "User account reactivated successfully"
		: "User account suspended successfully";

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message,
		data: result,
	});
});

export const UserController = {
	updateProfile,
	getUsers,
	toggleUserStatus,
};
