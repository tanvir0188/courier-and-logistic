import httpStatus from "http-status";
import type { Prisma } from "../../../generated/prisma/client";
import { Role, ShipmentStatus } from "../../../generated/prisma/enums";
import { prisma } from "../../lib/prisma";
import type { RequestUser } from "../../middleware/checkAuth";
import { AppError } from "../../utils/AppError";
import type {
	ICreateShipmentPayload,
	IShipmentFilterRequest,
} from "./shipment.interface";

// Helper to generate a unique readable tracking number
const generateTrackingNumber = (): string => {
	const timestamp = Date.now().toString(36).toUpperCase();
	const random = Math.random().toString(36).substring(2, 7).toUpperCase();
	return `TRK-${timestamp}-${random}`;
};

const createShipment = async (
	customerId: string,
	payload: ICreateShipmentPayload,
) => {
	// 1. Verify Provider exists, has Role.PROVIDER, and is active
	const provider = await prisma.user.findUnique({
		where: { id: payload.providerId },
	});

	if (!provider || provider.role !== Role.PROVIDER) {
		throw new AppError(
			httpStatus.BAD_REQUEST,
			"Invalid provider. The specified provider does not exist or is not registered as a provider.",
		);
	}

	if (!provider.isActive) {
		throw new AppError(
			httpStatus.BAD_REQUEST,
			"The specified provider is currently inactive.",
		);
	}

	// 2. Verify Sender Zone and Receiver Zone exist
	const [senderZone, receiverZone] = await Promise.all([
		prisma.zone.findUnique({ where: { id: payload.senderZoneId } }),
		prisma.zone.findUnique({ where: { id: payload.receiverZoneId } }),
	]);

	if (!senderZone) {
		throw new AppError(httpStatus.NOT_FOUND, "Sender zone not found");
	}

	if (!receiverZone) {
		throw new AppError(httpStatus.NOT_FOUND, "Receiver zone not found");
	}

	// 3. Calculate delivery fee if not explicitly passed
	const isIntraZone = payload.senderZoneId === payload.receiverZoneId;
	const baseFee = isIntraZone ? 60 : 120;
	const extraWeight = Math.max(0, payload.weight - 1);
	const weightRate = extraWeight * (isIntraZone ? 15 : 25);
	const deliveryFee =
		payload.deliveryFee !== undefined
			? payload.deliveryFee
			: Math.round((baseFee + weightRate) * 100) / 100;

	const totalAmount =
		payload.totalAmount !== undefined ? payload.totalAmount : deliveryFee;

	const trackingNumber = generateTrackingNumber();

	// 4. Create Shipment with initial event
	const shipment = await prisma.shipment.create({
		data: {
			trackingNumber,
			customerId,
			providerId: payload.providerId,
			senderZoneId: payload.senderZoneId,
			receiverZoneId: payload.receiverZoneId,
			senderName: payload.senderName.trim(),
			senderPhone: payload.senderPhone.trim(),
			senderAddress: payload.senderAddress.trim(),
			receiverName: payload.receiverName.trim(),
			receiverPhone: payload.receiverPhone.trim(),
			receiverAddress: payload.receiverAddress.trim(),
			parcelDescription: payload.parcelDescription?.trim(),
			weight: payload.weight,
			quantity: payload.quantity ?? 1,
			deliveryFee,
			totalAmount,
			status: ShipmentStatus.CREATED,
			events: {
				create: {
					status: ShipmentStatus.CREATED,
					description: "Shipment created successfully by customer",
				},
			},
		},
		include: {
			customer: {
				select: {
					id: true,
					name: true,
					email: true,
					phone: true,
				},
			},
			provider: {
				select: {
					id: true,
					name: true,
					email: true,
					phone: true,
				},
			},
			senderZone: true,
			receiverZone: true,
			events: true,
		},
	});

	return shipment;
};

const getAllShipments = async (
	currentUser: RequestUser,
	filters: IShipmentFilterRequest,
) => {
	const page = Math.max(1, Number(filters.page) || 1);
	const limit = Math.max(1, Number(filters.limit) || 20);
	const skip = (page - 1) * limit;
	const sortBy = filters.sortBy || "createdAt";
	const sortOrder = filters.sortOrder === "asc" ? "asc" : "desc";

	const andConditions: Prisma.ShipmentWhereInput[] = [];

	// 1. Strict Role-based access control scoping
	if (currentUser.role === Role.CUSTOMER) {
		andConditions.push({ customerId: currentUser.userId });
	} else if (currentUser.role === Role.PROVIDER) {
		andConditions.push({ providerId: currentUser.userId });
	} else if (currentUser.role === Role.ADMIN) {
		if (filters.customerId) {
			andConditions.push({ customerId: filters.customerId });
		}
		if (filters.providerId) {
			andConditions.push({ providerId: filters.providerId });
		}
	}

	// 2. Direct filter by status
	if (filters.status) {
		andConditions.push({ status: filters.status });
	}

	// 3. Direct filter by shipmentId
	if (filters.shipmentId) {
		andConditions.push({ id: filters.shipmentId.trim() });
	}

	// 4. Direct filter by trackingNumber
	if (filters.trackingNumber) {
		andConditions.push({
			trackingNumber: {
				contains: filters.trackingNumber.trim(),
				mode: "insensitive",
			},
		});
	}

	// 5. Search by Customer Email: find customer ID first, then filter customerId
	if (filters.customerEmail) {
		const matchedCustomers = await prisma.user.findMany({
			where: {
				email: {
					contains: filters.customerEmail.trim(),
					mode: "insensitive",
				},
				role: Role.CUSTOMER,
			},
			select: { id: true },
		});

		const customerIds = matchedCustomers.map((c) => c.id);
		if (customerIds.length > 0) {
			andConditions.push({ customerId: { in: customerIds } });
		} else {
			// No matching customer found
			andConditions.push({ customerId: "no_matching_customer" });
		}
	}

	// 6. Search by Provider Email: find provider ID first, then filter providerId
	if (filters.providerEmail) {
		const matchedProviders = await prisma.user.findMany({
			where: {
				email: {
					contains: filters.providerEmail.trim(),
					mode: "insensitive",
				},
				role: Role.PROVIDER,
			},
			select: { id: true },
		});

		const providerIds = matchedProviders.map((p) => p.id);
		if (providerIds.length > 0) {
			andConditions.push({ providerId: { in: providerIds } });
		} else {
			// No matching provider found
			andConditions.push({ providerId: "no_matching_provider" });
		}
	}

	// 7. General email search (matches either customer or provider)
	if (filters.email) {
		const matchedUsers = await prisma.user.findMany({
			where: {
				email: {
					contains: filters.email.trim(),
					mode: "insensitive",
				},
			},
			select: { id: true, role: true },
		});

		const customerIds = matchedUsers
			.filter((u) => u.role === Role.CUSTOMER)
			.map((u) => u.id);
		const providerIds = matchedUsers
			.filter((u) => u.role === Role.PROVIDER)
			.map((u) => u.id);

		const emailOrConditions: Prisma.ShipmentWhereInput[] = [];
		if (customerIds.length > 0) {
			emailOrConditions.push({ customerId: { in: customerIds } });
		}
		if (providerIds.length > 0) {
			emailOrConditions.push({ providerId: { in: providerIds } });
		}

		if (emailOrConditions.length > 0) {
			andConditions.push({ OR: emailOrConditions });
		} else {
			andConditions.push({ customerId: "no_matching_email" });
		}
	}

	// 8. Search by Zone Name: find Zone IDs first, then filter senderZoneId or receiverZoneId
	if (filters.zoneName) {
		const matchedZones = await prisma.zone.findMany({
			where: {
				name: {
					contains: filters.zoneName.trim(),
					mode: "insensitive",
				},
			},
			select: { id: true },
		});

		const zoneIds = matchedZones.map((z) => z.id);
		if (zoneIds.length > 0) {
			andConditions.push({
				OR: [
					{ senderZoneId: { in: zoneIds } },
					{ receiverZoneId: { in: zoneIds } },
				],
			});
		} else {
			andConditions.push({ senderZoneId: "no_matching_zone" });
		}
	}

	// 9. Free-text searchTerm (combines email lookup, zone name lookup, tracking number, and contact info)
	if (filters.searchTerm) {
		const term = filters.searchTerm.trim();

		// Lookup users by email or name matching term
		const matchedUsers = await prisma.user.findMany({
			where: {
				OR: [
					{ email: { contains: term, mode: "insensitive" } },
					{ name: { contains: term, mode: "insensitive" } },
				],
			},
			select: { id: true },
		});
		const matchedUserIds = matchedUsers.map((u) => u.id);

		// Lookup zones by name matching term
		const matchedZones = await prisma.zone.findMany({
			where: {
				name: { contains: term, mode: "insensitive" },
			},
			select: { id: true },
		});
		const matchedZoneIds = matchedZones.map((z) => z.id);

		const searchOrConditions: Prisma.ShipmentWhereInput[] = [
			{ trackingNumber: { contains: term, mode: "insensitive" } },
			{ id: { contains: term, mode: "insensitive" } },
			{ receiverName: { contains: term, mode: "insensitive" } },
			{ receiverPhone: { contains: term, mode: "insensitive" } },
			{ senderName: { contains: term, mode: "insensitive" } },
			{ senderPhone: { contains: term, mode: "insensitive" } },
		];

		if (matchedUserIds.length > 0) {
			searchOrConditions.push({ customerId: { in: matchedUserIds } });
			searchOrConditions.push({ providerId: { in: matchedUserIds } });
		}

		if (matchedZoneIds.length > 0) {
			searchOrConditions.push({ senderZoneId: { in: matchedZoneIds } });
			searchOrConditions.push({ receiverZoneId: { in: matchedZoneIds } });
		}

		andConditions.push({ OR: searchOrConditions });
	}

	const where: Prisma.ShipmentWhereInput =
		andConditions.length > 0 ? { AND: andConditions } : {};

	const [shipments, total] = await Promise.all([
		prisma.shipment.findMany({
			where,
			skip,
			take: limit,
			orderBy: {
				[sortBy]: sortOrder,
			},
			include: {
				customer: {
					select: {
						id: true,
						name: true,
						email: true,
						phone: true,
					},
				},
				provider: {
					select: {
						id: true,
						name: true,
						email: true,
						phone: true,
					},
				},
				pickupCourier: {
					select: {
						id: true,
						name: true,
						phone: true,
						status: true,
					},
				},
				deliveryCourier: {
					select: {
						id: true,
						name: true,
						phone: true,
						status: true,
					},
				},
				senderZone: true,
				receiverZone: true,
				_count: {
					select: {
						events: true,
					},
				},
			},
		}),
		prisma.shipment.count({ where }),
	]);

	return {
		meta: {
			page,
			limit,
			total,
			totalPages: Math.ceil(total / limit),
		},
		data: shipments,
	};
};

const getShipmentById = async (currentUser: RequestUser, id: string) => {
	const shipment = await prisma.shipment.findUnique({
		where: { id },
		include: {
			customer: {
				select: {
					id: true,
					name: true,
					email: true,
					phone: true,
				},
			},
			provider: {
				select: {
					id: true,
					name: true,
					email: true,
					phone: true,
				},
			},
			pickupCourier: {
				select: {
					id: true,
					name: true,
					phone: true,
					status: true,
					zone: true,
				},
			},
			deliveryCourier: {
				select: {
					id: true,
					name: true,
					phone: true,
					status: true,
					zone: true,
				},
			},
			senderZone: true,
			receiverZone: true,
			events: {
				orderBy: {
					createdAt: "asc",
				},
			},
			payment: true,
		},
	});

	if (!shipment) {
		throw new AppError(httpStatus.NOT_FOUND, "Shipment not found");
	}

	// Authorization check
	if (
		currentUser.role === Role.CUSTOMER &&
		shipment.customerId !== currentUser.userId
	) {
		throw new AppError(
			httpStatus.FORBIDDEN,
			"You do not have permission to view this shipment",
		);
	}

	if (
		currentUser.role === Role.PROVIDER &&
		shipment.providerId !== currentUser.userId
	) {
		throw new AppError(
			httpStatus.FORBIDDEN,
			"You do not have permission to view this shipment",
		);
	}

	return shipment;
};

const getShipmentByTrackingNumber = async (
	currentUser: RequestUser,
	trackingNumber: string,
) => {
	const shipment = await prisma.shipment.findUnique({
		where: { trackingNumber },
		include: {
			customer: {
				select: {
					id: true,
					name: true,
					email: true,
					phone: true,
				},
			},
			provider: {
				select: {
					id: true,
					name: true,
					email: true,
					phone: true,
				},
			},
			pickupCourier: {
				select: {
					id: true,
					name: true,
					phone: true,
					status: true,
					zone: true,
				},
			},
			deliveryCourier: {
				select: {
					id: true,
					name: true,
					phone: true,
					status: true,
					zone: true,
				},
			},
			senderZone: true,
			receiverZone: true,
			events: {
				orderBy: {
					createdAt: "asc",
				},
			},
			payment: true,
		},
	});

	if (!shipment) {
		throw new AppError(httpStatus.NOT_FOUND, "Shipment not found");
	}

	// Authorization check
	if (
		currentUser.role === Role.CUSTOMER &&
		shipment.customerId !== currentUser.userId
	) {
		throw new AppError(
			httpStatus.FORBIDDEN,
			"You do not have permission to view this shipment",
		);
	}

	if (
		currentUser.role === Role.PROVIDER &&
		shipment.providerId !== currentUser.userId
	) {
		throw new AppError(
			httpStatus.FORBIDDEN,
			"You do not have permission to view this shipment",
		);
	}

	return shipment;
};

export const ShipmentService = {
	createShipment,
	getAllShipments,
	getShipmentById,
	getShipmentByTrackingNumber,
};
