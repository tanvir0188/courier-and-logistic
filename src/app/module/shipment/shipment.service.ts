import httpStatus from "http-status";
import type { Prisma } from "../../../generated/prisma/client";
import {
	CourierStatus,
	PaymentStatus,
	Role,
	ShipmentStatus,
} from "../../../generated/prisma/enums";
import { prisma } from "../../lib/prisma";
import type { RequestUser } from "../../middleware/checkAuth";
import { AppError } from "../../utils/AppError";
import { emitShipmentStatusUpdate } from "../../lib/socket";
import type {
	IAssignCourierPayload,
	ICreateShipmentPayload,
	IShipmentFilterRequest,
} from "./shipment.interface";
import { scheduleShipmentSimulation } from "./shipment.simulator";

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

	const include: Prisma.ShipmentInclude = {
		customer: {
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
		senderZone: {
			select: {
				id: true,
				name: true,
			},
		},
		receiverZone: {
			select: {
				id: true,
				name: true,
			},
		},
		payment: {
			select: {
				id: true,
				gateway: true,
				amount: true,
				status: true,
				transactionId: true,
				paidAt: true,
			},
		},
		_count: {
			select: {
				events: true,
			},
		},
	};

	if (currentUser.role === Role.ADMIN) {
		include.provider = {
			select: {
				id: true,
				name: true,
				phone: true,
				email: true,
			},
		};
	}

	const [shipments, total] = await Promise.all([
		prisma.shipment.findMany({
			where,
			skip,
			take: limit,
			orderBy: {
				[sortBy]: sortOrder,
			},
			include,
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

const assignCourier = async (
	currentUser: RequestUser,
	shipmentId: string,
	payload: IAssignCourierPayload,
) => {
	// 1. Fetch shipment with zones and payment
	const shipment = await prisma.shipment.findUnique({
		where: { id: shipmentId },
		include: {
			senderZone: true,
			receiverZone: true,
			payment: true,
		},
	});

	if (!shipment) {
		throw new AppError(httpStatus.NOT_FOUND, "Shipment not found");
	}

	// 2. Authorization: Providers can only assign couriers to their own shipments
	if (
		currentUser.role === Role.PROVIDER &&
		shipment.providerId !== currentUser.userId
	) {
		throw new AppError(
			httpStatus.FORBIDDEN,
			"You do not have permission to assign couriers to this shipment",
		);
	}

	// 3. Status validation: Terminal shipments cannot be reassigned
	const nonAssignableStatuses: ShipmentStatus[] = [
		ShipmentStatus.DELIVERED,
		ShipmentStatus.CANCELLED,
		ShipmentStatus.RETURNED,
	];

	if (nonAssignableStatuses.includes(shipment.status)) {
		throw new AppError(
			httpStatus.BAD_REQUEST,
			`Cannot assign courier to a shipment with status '${shipment.status}'`,
		);
	}

	// 4. Payment validation: Courier can only be assigned once payment is completed
	const isPaymentCompleted =
		shipment.status === ShipmentStatus.PAYMENT_CONFIRMED ||
		shipment.payment?.status === PaymentStatus.SUCCESS;

	if (!isPaymentCompleted) {
		throw new AppError(
			httpStatus.BAD_REQUEST,
			"Cannot assign courier: Payment for this shipment has not been completed. The shipment must be in PAYMENT_CONFIRMED status before a courier can be assigned.",
		);
	}

	const isIntraZone = shipment.senderZoneId === shipment.receiverZoneId;

	let targetPickupCourierId: string | undefined = payload.pickupCourierId;
	let targetDeliveryCourierId: string | undefined = payload.deliveryCourierId;

	// Handle single courierId payload (convenient for intra-zone or simple single-courier dispatch)
	if (payload.courierId) {
		if (isIntraZone) {
			targetPickupCourierId = targetPickupCourierId ?? payload.courierId;
			targetDeliveryCourierId = targetDeliveryCourierId ?? payload.courierId;
		} else {
			const courier = await prisma.courier.findUnique({
				where: { id: payload.courierId },
				include: { zone: true },
			});

			if (!courier) {
				throw new AppError(httpStatus.NOT_FOUND, "Courier not found");
			}

			if (courier.zoneId === shipment.senderZoneId) {
				targetPickupCourierId = targetPickupCourierId ?? payload.courierId;
			} else if (courier.zoneId === shipment.receiverZoneId) {
				targetDeliveryCourierId = targetDeliveryCourierId ?? payload.courierId;
			} else {
				throw new AppError(
					httpStatus.BAD_REQUEST,
					`Courier '${courier.name}' is registered in zone '${courier.zone.name}', which matches neither sender zone ('${shipment.senderZone.name}') nor receiver zone ('${shipment.receiverZone.name}') of this inter-zone shipment`,
				);
			}
		}
	}

	if (!targetPickupCourierId && !targetDeliveryCourierId) {
		throw new AppError(
			httpStatus.BAD_REQUEST,
			"No valid pickup or delivery courier specified for assignment",
		);
	}

	// 4. Fetch and validate target couriers
	const courierIdsToFetch = Array.from(
		new Set(
			[targetPickupCourierId, targetDeliveryCourierId].filter(
				Boolean,
			) as string[],
		),
	);

	const couriers = await prisma.courier.findMany({
		where: {
			id: { in: courierIdsToFetch },
		},
		include: { zone: true },
	});

	if (couriers.length !== courierIdsToFetch.length) {
		throw new AppError(
			httpStatus.NOT_FOUND,
			"One or more specified couriers were not found",
		);
	}

	const courierMap = new Map(couriers.map((c) => [c.id, c]));

	if (targetPickupCourierId) {
		const pickupCourier = courierMap.get(targetPickupCourierId)!;

		if (pickupCourier.providerId !== shipment.providerId) {
			throw new AppError(
				httpStatus.BAD_REQUEST,
				`Pickup courier '${pickupCourier.name}' does not belong to the shipment provider`,
			);
		}

		if (pickupCourier.status === CourierStatus.OFFLINE) {
			throw new AppError(
				httpStatus.BAD_REQUEST,
				`Pickup courier '${pickupCourier.name}' is currently OFFLINE and cannot be assigned`,
			);
		}

		if (pickupCourier.zoneId !== shipment.senderZoneId) {
			throw new AppError(
				httpStatus.BAD_REQUEST,
				`Pickup courier '${pickupCourier.name}' is in zone '${pickupCourier.zone.name}', but sender zone is '${shipment.senderZone.name}'`,
			);
		}
	}

	if (targetDeliveryCourierId) {
		const deliveryCourier = courierMap.get(targetDeliveryCourierId)!;

		if (deliveryCourier.providerId !== shipment.providerId) {
			throw new AppError(
				httpStatus.BAD_REQUEST,
				`Delivery courier '${deliveryCourier.name}' does not belong to the shipment provider`,
			);
		}

		if (deliveryCourier.status === CourierStatus.OFFLINE) {
			throw new AppError(
				httpStatus.BAD_REQUEST,
				`Delivery courier '${deliveryCourier.name}' is currently OFFLINE and cannot be assigned`,
			);
		}

		if (deliveryCourier.zoneId !== shipment.receiverZoneId) {
			throw new AppError(
				httpStatus.BAD_REQUEST,
				`Delivery courier '${deliveryCourier.name}' is in zone '${deliveryCourier.zone.name}', but receiver zone is '${shipment.receiverZone.name}'`,
			);
		}
	}

	// 5. Construct event description & determine new status
	const assignedNames: string[] = [];
	if (
		targetPickupCourierId &&
		targetDeliveryCourierId &&
		targetPickupCourierId === targetDeliveryCourierId
	) {
		const c = courierMap.get(targetPickupCourierId)!;
		assignedNames.push(`Courier '${c.name}' (Pickup & Delivery)`);
	} else {
		if (targetPickupCourierId) {
			const pc = courierMap.get(targetPickupCourierId)!;
			assignedNames.push(`Pickup courier '${pc.name}'`);
		}
		if (targetDeliveryCourierId) {
			const dc = courierMap.get(targetDeliveryCourierId)!;
			assignedNames.push(`Delivery courier '${dc.name}'`);
		}
	}

	const shouldUpdateStatus =
		shipment.status === ShipmentStatus.PAYMENT_CONFIRMED;

	const newStatus = shouldUpdateStatus
		? ShipmentStatus.COURIER_ASSIGNED
		: shipment.status;

	const assignedByRole = currentUser.role === Role.ADMIN ? "Admin" : "Provider";
	const eventDescription = `Assigned ${assignedNames.join(", ")} by ${assignedByRole}`;

	// 6. Execute atomic update
	const updatedShipment = await prisma.$transaction(async (tx) => {
		// Set available couriers to busy
		for (const courier of couriers) {
			if (courier.status === CourierStatus.AVAILABLE) {
				await tx.courier.update({
					where: { id: courier.id },
					data: { status: CourierStatus.BUSY },
				});
			}
		}

		return await tx.shipment.update({
			where: { id: shipmentId },
			data: {
				...(targetPickupCourierId && {
					pickupCourierId: targetPickupCourierId,
				}),
				...(targetDeliveryCourierId && {
					deliveryCourierId: targetDeliveryCourierId,
				}),
				status: newStatus,
				events: {
					create: {
						status: newStatus,
						description: eventDescription,
					},
				},
			},
			include: {
				senderZone: true,
				receiverZone: true,
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
				payment: true,
				events: {
					orderBy: {
						createdAt: "asc",
					},
				},
				...(currentUser.role === Role.ADMIN && {
					provider: {
						select: {
							id: true,
							name: true,
							phone: true,
							email: true,
						},
					},
				}),
				customer: {
					select: {
						id: true,
						name: true,
						email: true,
						phone: true,
					},
				},
			},
		});
	});

	// Emit realtime live update on socket
	const courierName =
		updatedShipment.deliveryCourier?.name ||
		updatedShipment.pickupCourier?.name ||
		null;

	emitShipmentStatusUpdate(updatedShipment.trackingNumber, {
		shipmentId: updatedShipment.id,
		trackingNumber: updatedShipment.trackingNumber,
		status: newStatus,
		description: eventDescription,
		timestamp: new Date().toISOString(),
		senderZone: updatedShipment.senderZone.name,
		receiverZone: updatedShipment.receiverZone.name,
		courierName,
	});

	// Trigger background simulation (updates every 20 seconds via QStash / local timer)
	if (newStatus === ShipmentStatus.COURIER_ASSIGNED) {
		scheduleShipmentSimulation(
			updatedShipment.id,
			ShipmentStatus.COURIER_ASSIGNED,
			updatedShipment.trackingNumber,
		);
	}

	return updatedShipment;
};

const getAvailableCouriersForShipment = async (
	currentUser: RequestUser,
	shipmentId: string,
) => {
	const shipment = await prisma.shipment.findUnique({
		where: { id: shipmentId },
		include: {
			senderZone: true,
			receiverZone: true,
		},
	});

	if (!shipment) {
		throw new AppError(httpStatus.NOT_FOUND, "Shipment not found");
	}

	if (
		currentUser.role === Role.PROVIDER &&
		shipment.providerId !== currentUser.userId
	) {
		throw new AppError(
			httpStatus.FORBIDDEN,
			"You do not have permission to view couriers for this shipment",
		);
	}

	const isIntraZone = shipment.senderZoneId === shipment.receiverZoneId;

	const activeShipmentStatuses: ShipmentStatus[] = [
		ShipmentStatus.CREATED,
		ShipmentStatus.PAYMENT_CONFIRMED,
		ShipmentStatus.COURIER_ASSIGNED,
		ShipmentStatus.PICKED_UP,
		ShipmentStatus.IN_TRANSIT,
		ShipmentStatus.OUT_FOR_DELIVERY,
	];

	const zoneIds = isIntraZone
		? [shipment.senderZoneId]
		: Array.from(new Set([shipment.senderZoneId, shipment.receiverZoneId]));

	const couriers = await prisma.courier.findMany({
		where: {
			providerId: shipment.providerId,
			zoneId: { in: zoneIds },
		},
		include: {
			zone: true,
			pickupShipments: {
				where: {
					status: { in: activeShipmentStatuses },
				},
				select: { id: true },
			},
			deliveryShipments: {
				where: {
					status: { in: activeShipmentStatuses },
				},
				select: { id: true },
			},
		},
		orderBy: {
			name: "asc",
		},
	});

	const formatCourier = (c: (typeof couriers)[number]) => {
		const uniqueActiveShipmentIds = new Set([
			...c.pickupShipments.map((s) => s.id),
			...c.deliveryShipments.map((s) => s.id),
		]);

		return {
			id: c.id,
			name: c.name,
			phone: c.phone,
			status: c.status,
			zoneId: c.zoneId,
			zoneName: c.zone.name,
			activeShipmentsCount: uniqueActiveShipmentIds.size,
		};
	};

	const pickupCouriers = couriers
		.filter((c) => c.zoneId === shipment.senderZoneId)
		.map(formatCourier);

	const deliveryCouriers = couriers
		.filter((c) => c.zoneId === shipment.receiverZoneId)
		.map(formatCourier);

	return {
		shipmentId: shipment.id,
		trackingNumber: shipment.trackingNumber,
		isIntraZone,
		senderZone: {
			id: shipment.senderZone.id,
			name: shipment.senderZone.name,
		},
		receiverZone: {
			id: shipment.receiverZone.id,
			name: shipment.receiverZone.name,
		},
		currentPickupCourierId: shipment.pickupCourierId,
		currentDeliveryCourierId: shipment.deliveryCourierId,
		pickupCouriers,
		deliveryCouriers,
	};
};

export const ShipmentService = {
	createShipment,
	getAllShipments,
	getShipmentById,
	getShipmentByTrackingNumber,
	assignCourier,
	getAvailableCouriersForShipment,
};
