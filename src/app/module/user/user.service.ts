import type { UploadApiResponse } from "cloudinary";
import httpStatus from "http-status";
import type { Prisma } from "../../../generated/prisma/client";
import { cloudinary } from "../../lib/cloudinary";
import { prisma } from "../../lib/prisma";
import { AppError } from "../../utils/AppError";
import { Role } from "../../../generated/prisma/enums";
import type { RequestUser } from "../../middleware/checkAuth";
import type {
	IUpdateProfilePayload,
	IUserFilterRequest,
} from "./user.interface";

const updateProfile = async (
	userId: string,
	payload?: IUpdateProfilePayload,
	fileBuffer?: Buffer,
) => {
	const currentUser = await prisma.user.findUnique({
		where: {
			id: userId,
		},
	});

	if (!currentUser) {
		throw new AppError(httpStatus.NOT_FOUND, "User not found");
	}

	let uploadedProfilePicUrl: string | undefined;

	if (fileBuffer) {
		const cloudinaryResult = await new Promise<UploadApiResponse>(
			(resolve, reject) => {
				cloudinary.uploader
					.upload_stream(
						{
							resource_type: "image",
							folder: `courier_service/${currentUser.role}`,
						},
						(error, result) => {
							if (error) {
								return reject(error);
							}
							if (!result) {
								return reject(new Error("No result returned from Cloudinary"));
							}
							resolve(result);
						},
					)
					.end(fileBuffer);
			},
		);

		uploadedProfilePicUrl = cloudinaryResult.secure_url;

		if (currentUser.profilePic) {
			try {
				const parts = currentUser.profilePic.split("/");
				const fileName = parts.pop()?.split(".")[0];
				const uploadIdx = parts.indexOf("upload");
				let publicId = fileName;
				if (uploadIdx !== -1 && parts.length > uploadIdx + 1) {
					const subParts = parts
						.slice(uploadIdx + 1)
						.filter((p) => !/^v\d+$/.test(p));
					publicId =
						subParts.length > 0
							? `${subParts.join("/")}/${fileName}`
							: fileName;
				}
				if (publicId) {
					await cloudinary.uploader.destroy(publicId);
				}
			} catch (error) {
				console.log("Error deleting old profile pic:", error);
			}
		}
	}

	const updateData: {
		name?: string;
		phone?: string;
		profilePic?: string;
	} = {};

	if (payload?.name && payload.name.trim() !== "") {
		updateData.name = payload.name.trim();
	}

	if (payload?.phone !== undefined) {
		updateData.phone = payload.phone.trim();
	}

	if (uploadedProfilePicUrl) {
		updateData.profilePic = uploadedProfilePicUrl;
	} else if (payload?.profilePic && payload.profilePic.trim() !== "") {
		updateData.profilePic = payload.profilePic.trim();
	}

	const updatedUser = await prisma.user.update({
		where: {
			id: userId,
		},
		data: updateData,
		omit: {
			passwordHash: true,
		},
	});

	return updatedUser;
};

const getAllUsers = async (
	currentUserOrFilters?: RequestUser | IUserFilterRequest,
	filtersOrUser?: IUserFilterRequest | RequestUser,
) => {
	let currentUser: RequestUser | undefined;
	let filters: IUserFilterRequest = {};

	if (currentUserOrFilters && "userId" in currentUserOrFilters) {
		currentUser = currentUserOrFilters as RequestUser;
		filters = (filtersOrUser as IUserFilterRequest) || {};
	} else if (filtersOrUser && "userId" in filtersOrUser) {
		currentUser = filtersOrUser as RequestUser;
		filters = (currentUserOrFilters as IUserFilterRequest) || {};
	} else {
		filters = (currentUserOrFilters as IUserFilterRequest) || {};
	}

	const page = Math.max(1, Number(filters.page) || 1);
	const limit = Math.max(1, Number(filters.limit) || 10);
	const skip = (page - 1) * limit;
	const sortBy = filters.sortBy || "createdAt";
	const sortOrder = filters.sortOrder === "asc" ? "asc" : "desc";

	const where: Prisma.UserWhereInput = {};

	const requestingUserRole =
		currentUser?.role || filters.currentUser?.role || filters.userRole;

	// If the role is customer, they can only see users that have provider role
	if (requestingUserRole === Role.CUSTOMER) {
		where.role = Role.PROVIDER;
	} else if (filters.role) {
		where.role = filters.role;
	}

	if (filters.isActive !== undefined) {
		where.isActive = filters.isActive === "true" || filters.isActive === true;
	}

	if (filters.searchTerm) {
		const search = filters.searchTerm.trim();
		where.OR = [
			{
				name: {
					contains: search,
					mode: "insensitive",
				},
			},
			{
				email: {
					contains: search,
					mode: "insensitive",
				},
			},
		];
	} else {
		const conditions: Prisma.UserWhereInput[] = [];

		if (filters.name) {
			conditions.push({
				name: {
					contains: filters.name.trim(),
					mode: "insensitive",
				},
			});
		}

		if (filters.email) {
			conditions.push({
				email: {
					contains: filters.email.trim(),
					mode: "insensitive",
				},
			});
		}

		if (conditions.length > 0) {
			where.AND = conditions;
		}
	}

	const [users, total] = await Promise.all([
		prisma.user.findMany({
			where,
			skip,
			take: limit,
			orderBy: {
				[sortBy]: sortOrder,
			},
			select: {
				id: true,
				name: true,
				email: true,
				role: true,
				phone: true,
				profilePic: true,
				isActive: true,
				createdAt: true,
				updatedAt: true,
			},
		}),
		prisma.user.count({ where }),
	]);

	return {
		meta: {
			page,
			limit,
			total,
			totalPages: Math.ceil(total / limit),
		},
		data: users,
	};
};

const toggleUserStatus = async (
	currentUserId: string,
	targetUserId: string,
	explicitStatus?: boolean,
) => {
	if (currentUserId === targetUserId) {
		throw new AppError(
			httpStatus.BAD_REQUEST,
			"You cannot suspend or modify your own account status",
		);
	}

	const existingUser = await prisma.user.findUnique({
		where: { id: targetUserId },
	});

	if (!existingUser) {
		throw new AppError(httpStatus.NOT_FOUND, "User not found");
	}

	const newStatus =
		explicitStatus !== undefined ? explicitStatus : !existingUser.isActive;

	const updatedUser = await prisma.user.update({
		where: { id: targetUserId },
		data: { isActive: newStatus },
		select: {
			id: true,
			name: true,
			email: true,
			role: true,
			phone: true,
			profilePic: true,
			isActive: true,
			createdAt: true,
			updatedAt: true,
		},
	});

	return updatedUser;
};

export const UserServices = {
	updateProfile,
	getAllUsers,
	toggleUserStatus,
};
