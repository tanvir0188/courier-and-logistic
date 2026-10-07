import type { Request, Response } from "express";
import httpStatus from "http-status";
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

export const UserController = {
	updateProfile
};
