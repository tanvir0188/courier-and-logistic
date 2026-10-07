
import httpStatus from "http-status";
import { prisma } from "../../lib/prisma";
import { AppError } from "../../utils/AppError";
import type {
	ICreateZonePayload,
	IUpdateZonePayload,
	IZoneFilterRequest,
} from "./zone.interface";
import { Prisma } from "../../../generated/prisma/client";

const createZone = async (payload: ICreateZonePayload) => {
	const name = payload.name.trim();

	const isZoneExist = await prisma.zone.findFirst({
		where: {
			name: {
				equals: name,
				mode: "insensitive",
			},
		},
	});

	if (isZoneExist) {
		throw new AppError(httpStatus.CONFLICT, `Zone '${name}' already exists`);
	}

	const zone = await prisma.zone.create({
		data: {
			name,
		},
	});

	return zone;
};

const getAllZones = async (filters: IZoneFilterRequest) => {
	const page = Math.max(1, Number(filters.page) || 1);
	const limit = Math.max(1, Number(filters.limit) || 20);
	const skip = (page - 1) * limit;
	const sortBy = filters.sortBy || "name";
	const sortOrder = filters.sortOrder === "desc" ? "desc" : "asc";

	const where: Prisma.ZoneWhereInput = {};

	if (filters.searchTerm) {
		where.name = {
			contains: filters.searchTerm.trim(),
			mode: "insensitive",
		};
	}

	const [zones, total] = await Promise.all([
		prisma.zone.findMany({
			where,
			skip,
			take: limit,
			orderBy: {
				[sortBy]: sortOrder,
			},
			include: {
				_count: {
					select: { couriers: true },
				},
			},
		}),
		prisma.zone.count({ where }),
	]);

	return {
		meta: {
			page,
			limit,
			total,
			totalPages: Math.ceil(total / limit),
		},
		data: zones,
	};
};

const getZoneById = async (id: string) => {
	const zone = await prisma.zone.findUnique({
		where: { id },
		include: {
			couriers: {
				select: {
					id: true,
					name: true,
					phone: true,
					status: true,
					providerId: true,
				},
			},
			_count: {
				select: { couriers: true },
			},
		},
	});

	if (!zone) {
		throw new AppError(httpStatus.NOT_FOUND, "Zone not found");
	}

	return zone;
};

const updateZone = async (id: string, payload: IUpdateZonePayload) => {
	const name = payload.name.trim();

	const existingZone = await prisma.zone.findUnique({
		where: { id },
	});

	if (!existingZone) {
		throw new AppError(httpStatus.NOT_FOUND, "Zone not found");
	}

	const isNameTaken = await prisma.zone.findFirst({
		where: {
			name: {
				equals: name,
				mode: "insensitive",
			},
			NOT: {
				id,
			},
		},
	});

	if (isNameTaken) {
		throw new AppError(
			httpStatus.CONFLICT,
			`Zone name '${name}' is already in use`,
		);
	}

	const updatedZone = await prisma.zone.update({
		where: { id },
		data: { name },
	});

	return updatedZone;
};

const deleteZone = async (id: string) => {
	const existingZone = await prisma.zone.findUnique({
		where: { id },
	});

	if (!existingZone) {
		throw new AppError(httpStatus.NOT_FOUND, "Zone not found");
	}

	const deletedZone = await prisma.zone.delete({
		where: { id },
	});

	return deletedZone;
};

export const ZoneService = {
	createZone,
	getAllZones,
	getZoneById,
	updateZone,
	deleteZone,
};
