import { CourierStatus, Role } from "../../../generated/prisma/enums";
import type { Prisma } from "../../../generated/prisma/client";
import httpStatus from "http-status";
import { prisma } from "../../lib/prisma";
import type { RequestUser } from "../../middleware/checkAuth";
import { AppError } from "../../utils/AppError";
import type {
	ICreateCourierPayload,
	ICourierFilterRequest,
	IUpdateCourierPayload,
} from "./courier.interface";

const createCourier = async (
	providerId: string,
	payload: ICreateCourierPayload,
) => {
	const zone = await prisma.zone.findUnique({
		where: { id: payload.zoneId },
	});

	if (!zone) {
		throw new AppError(httpStatus.NOT_FOUND, "Zone not found");
	}

	const courier = await prisma.courier.create({
		data: {
			name: payload.name.trim(),
			phone: payload.phone.trim(),
			zoneId: payload.zoneId,
			status: payload.status || CourierStatus.AVAILABLE,
			providerId,
		},
		include: {
			zone: true,
		},
	});

	return courier;
};

const getAllCouriers = async (
	currentUser: RequestUser,
	filters: ICourierFilterRequest,
) => {
	const page = Math.max(1, Number(filters.page) || 1);
	const limit = Math.max(1, Number(filters.limit) || 20);
	const skip = (page - 1) * limit;
	const sortBy = filters.sortBy || "createdAt";
	const sortOrder = filters.sortOrder === "asc" ? "asc" : "desc";

	const where: Prisma.CourierWhereInput = {};

	// If provider, strictly scope to their own couriers
	if (currentUser.role === Role.PROVIDER) {
		where.providerId = currentUser.userId;
	} else if (filters.providerId) {
		where.providerId = filters.providerId;
	}

	if (filters.status) {
		where.status = filters.status;
	}

	if (filters.zoneId) {
		where.zoneId = filters.zoneId;
	}

	if (filters.searchTerm) {
		where.OR = [
			{
				name: {
					contains: filters.searchTerm.trim(),
					mode: "insensitive",
				},
			},
			{
				phone: {
					contains: filters.searchTerm.trim(),
					mode: "insensitive",
				},
			},
		];
	}

	const [couriers, total] = await Promise.all([
		prisma.courier.findMany({
			where,
			skip,
			take: limit,
			orderBy: {
				[sortBy]: sortOrder,
			},
			include: {
				zone: true,
				provider: {
					select: {
						id: true,
						name: true,
						email: true,
						phone: true,
					},
				},
				_count: {
					select: {
						pickupShipments: true,
						deliveryShipments: true,
					},
				},
			},
		}),
		prisma.courier.count({ where }),
	]);

	return {
		meta: {
			page,
			limit,
			total,
			totalPages: Math.ceil(total / limit),
		},
		data: couriers,
	};
};

const getCourierById = async (currentUser: RequestUser, id: string) => {
	const courier = await prisma.courier.findUnique({
		where: { id },
		include: {
			zone: true,
			provider: {
				select: {
					id: true,
					name: true,
					email: true,
					phone: true,
				},
			},
			_count: {
				select: {
					pickupShipments: true,
					deliveryShipments: true,
				},
			},
		},
	});

	if (!courier) {
		throw new AppError(httpStatus.NOT_FOUND, "Courier not found");
	}

	if (
		currentUser.role === Role.PROVIDER &&
		courier.providerId !== currentUser.userId
	) {
		throw new AppError(
			httpStatus.FORBIDDEN,
			"You do not have permission to view this courier",
		);
	}

	return courier;
};

const updateCourier = async (
	currentUser: RequestUser,
	id: string,
	payload: IUpdateCourierPayload,
) => {
	const courier = await prisma.courier.findUnique({
		where: { id },
	});

	if (!courier) {
		throw new AppError(httpStatus.NOT_FOUND, "Courier not found");
	}

	if (
		currentUser.role === Role.PROVIDER &&
		courier.providerId !== currentUser.userId
	) {
		throw new AppError(
			httpStatus.FORBIDDEN,
			"You can only update your own couriers",
		);
	}

	if (payload.zoneId) {
		const zone = await prisma.zone.findUnique({
			where: { id: payload.zoneId },
		});

		if (!zone) {
			throw new AppError(httpStatus.NOT_FOUND, "Zone not found");
		}
	}

	const updatedCourier = await prisma.courier.update({
		where: { id },
		data: {
			...(payload.name && { name: payload.name.trim() }),
			...(payload.phone && { phone: payload.phone.trim() }),
			...(payload.zoneId && { zoneId: payload.zoneId }),
			...(payload.status && { status: payload.status }),
		},
		include: {
			zone: true,
		},
	});

	return updatedCourier;
};

const deleteCourier = async (currentUser: RequestUser, id: string) => {
	const courier = await prisma.courier.findUnique({
		where: { id },
	});

	if (!courier) {
		throw new AppError(httpStatus.NOT_FOUND, "Courier not found");
	}

	if (
		currentUser.role === Role.PROVIDER &&
		courier.providerId !== currentUser.userId
	) {
		throw new AppError(
			httpStatus.FORBIDDEN,
			"You can only delete your own couriers",
		);
	}

	const deletedCourier = await prisma.courier.delete({
		where: { id },
	});

	return deletedCourier;
};

export const CourierService = {
	createCourier,
	getAllCouriers,
	getCourierById,
	updateCourier,
	deleteCourier,
};
