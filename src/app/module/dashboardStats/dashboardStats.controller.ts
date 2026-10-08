import type { Request, Response } from "express";
import httpStatus from "http-status";
import { Role } from "../../../generated/prisma/enums";
import { AppError } from "../../utils/AppError";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import type {
	IAdminDashboardStats,
	ICustomerDashboardStats,
	IProviderDashboardStats,
} from "./dashboardStats.interface";
import { DashboardStatsService } from "./dashboardStats.service";


const getDashboardStats = catchAsync(async (req: Request, res: Response) => {
	const currentUser = req.user;

	if (!currentUser) {
		throw new AppError(httpStatus.UNAUTHORIZED, "User not authenticated");
	}

	let result:
		| IProviderDashboardStats
		| ICustomerDashboardStats
		| IAdminDashboardStats;

	switch (currentUser.role) {
		case Role.PROVIDER:
			result = await DashboardStatsService.getProviderDashboardStats(
				currentUser.userId,
			);
			break;
		case Role.CUSTOMER:
			result = await DashboardStatsService.getCustomerDashboardStats(
				currentUser.userId,
			);
			break;
		case Role.ADMIN:
			result = await DashboardStatsService.getAdminDashboardStats();
			break;
		default:
			throw new AppError(
				httpStatus.FORBIDDEN,
				`Dashboard statistics are not available for role: ${currentUser.role}`,
			);
	}

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Dashboard statistics retrieved successfully",
		data: result,
	});
});

export const DashboardStatsController = {
	getDashboardStats,
};
