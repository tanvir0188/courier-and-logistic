import { CourierStatus, ShipmentStatus } from "../../../generated/prisma/enums";
import config from "../../config";
import { prisma } from "../../lib/prisma";
import { publishTask } from "../../lib/qstash";
import { emitShipmentStatusUpdate } from "../../lib/socket";

// Expected previous status mapping for optimistic concurrency control
const EXPECTED_PREVIOUS_STATUS: Record<ShipmentStatus, ShipmentStatus | null> =
	{
		[ShipmentStatus.CREATED]: null,
		[ShipmentStatus.PAYMENT_CONFIRMED]: null,
		[ShipmentStatus.COURIER_ASSIGNED]: null,
		[ShipmentStatus.PICKED_UP]: ShipmentStatus.COURIER_ASSIGNED,
		[ShipmentStatus.IN_TRANSIT]: ShipmentStatus.PICKED_UP,
		[ShipmentStatus.OUT_FOR_DELIVERY]: ShipmentStatus.IN_TRANSIT,
		[ShipmentStatus.DELIVERED]: ShipmentStatus.OUT_FOR_DELIVERY,
		[ShipmentStatus.DELIVERY_FAILED]: null,
		[ShipmentStatus.RETURNED]: null,
		[ShipmentStatus.CANCELLED]: null,
	};

// The ordered status progression for simulation
const STATUS_PROGRESSION: Record<
	ShipmentStatus,
	{
		next: ShipmentStatus;
		description: (names: {
			courier?: string;
			senderZone?: string;
			receiverZone?: string;
		}) => string;
	} | null
> = {
	[ShipmentStatus.CREATED]: null,
	[ShipmentStatus.PAYMENT_CONFIRMED]: null,
	[ShipmentStatus.COURIER_ASSIGNED]: {
		next: ShipmentStatus.PICKED_UP,
		description: ({ courier, senderZone }) =>
			`Courier ${courier || "assigned"} has picked up the parcel from ${senderZone || "sender location"}.`,
	},
	[ShipmentStatus.PICKED_UP]: {
		next: ShipmentStatus.IN_TRANSIT,
		description: ({ senderZone, receiverZone }) =>
			`Parcel is in transit from ${senderZone || "origin"} to ${receiverZone || "destination zone"}.`,
	},
	[ShipmentStatus.IN_TRANSIT]: {
		next: ShipmentStatus.OUT_FOR_DELIVERY,
		description: ({ courier, receiverZone }) =>
			`Parcel is out for delivery in ${receiverZone || "destination area"} with courier ${courier || "agent"}.`,
	},
	[ShipmentStatus.OUT_FOR_DELIVERY]: {
		next: ShipmentStatus.DELIVERED,
		description: ({ receiverZone }) =>
			`Parcel has been delivered successfully to recipient in ${receiverZone || "destination location"}.`,
	},
	[ShipmentStatus.DELIVERED]: null,
	[ShipmentStatus.DELIVERY_FAILED]: null,
	[ShipmentStatus.RETURNED]: null,
	[ShipmentStatus.CANCELLED]: null,
};

// In-memory set to prevent duplicate concurrent simulations for the same shipment step
const inFlightSimulations = new Set<string>();

export const scheduleShipmentSimulation = async (
	shipmentId: string,
	currentStatus: ShipmentStatus,
	trackingNumber?: string,
) => {
	const trackingTag = trackingNumber || shipmentId;
	const step = STATUS_PROGRESSION[currentStatus];

	if (!step) {
		console.log(
			`[Simulator:Schedule] Shipment [${trackingTag}] is at status '${currentStatus}'. No further simulation steps scheduled.`,
		);
		return;
	}

	const nextStatus = step.next;
	const backendUrl = config.bak_url;
	const isLocalhost =
		!backendUrl ||
		backendUrl.includes("localhost") ||
		backendUrl.includes("127.0.0.1");

	let publishedToQStash = false;

	if (!isLocalhost) {
		const targetUrl = `${backendUrl}/api/v1/shipment/simulate-status-update`;
		console.log(
			`[Simulator:QStash] 🚀 Publishing task for Shipment [${trackingTag}] -> Next: ${nextStatus} (delay: 20s) to ${targetUrl}`,
		);
		try {
			await publishTask({
				url: targetUrl,
				body: {
					shipmentId,
					nextStatus,
				},
				delay: "20s",
				retries: 2,
			});
			publishedToQStash = true;
			console.log(
				`[Simulator:QStash] ✅ Task successfully enqueued in QStash for Shipment [${trackingTag}] -> ${nextStatus}`,
			);
		} catch (err) {
			console.error(
				`[Simulator:QStash:Error] ❌ Failed to publish to QStash for Shipment [${trackingTag}]. Falling back to local timer. Reason:`,
				err,
			);
		}
	}

	// In local development (localhost) or when QStash fails, use 20s setTimeout simulation
	if (!publishedToQStash) {
		console.log(
			`[Simulator:LocalTimer] ⏱️ Scheduled 20-second timer for Shipment [${trackingTag}]: Current=${currentStatus} -> Next=${nextStatus}`,
		);
		setTimeout(async () => {
			try {
				await processSimulatedStatusUpdate(shipmentId, nextStatus);
			} catch (err) {
				console.error(
					`[Simulator:LocalTimer:Error] ❌ Error during local simulation step for Shipment [${trackingTag}] -> ${nextStatus}:`,
					err,
				);
			}
		}, 20000);
	}
};

export const processSimulatedStatusUpdate = async (
	shipmentId: string,
	targetStatus: ShipmentStatus,
) => {
	const lockKey = `${shipmentId}:${targetStatus}`;

	if (inFlightSimulations.has(lockKey)) {
		console.warn(
			`[Simulator:Guard] ⚠️ Simulation step '${lockKey}' is already in-flight. Discarding duplicate execution.`,
		);
		return null;
	}

	inFlightSimulations.add(lockKey);
	console.log(
		`[Simulator:Execute] 🔄 Processing status update: Shipment [${shipmentId}] -> Target: ${targetStatus}`,
	);

	try {
		const expectedPreviousStatus = EXPECTED_PREVIOUS_STATUS[targetStatus];

		// 1. Transaction strictly scoped to the Shipment entity to prevent cross-table deadlocks.
		// Uses optimistic concurrency: only update if the current status matches the expected predecessor.
		const updatedShipment = await prisma.$transaction(async (tx) => {
			const current = await tx.shipment.findUnique({
				where: { id: shipmentId },
				include: {
					senderZone: true,
					receiverZone: true,
					pickupCourier: true,
					deliveryCourier: true,
				},
			});

			if (!current) {
				console.error(
					`[Simulator:Error] ❌ Shipment [${shipmentId}] not found in database. Aborting simulation.`,
				);
				return null;
			}

			// Terminal states or mismatched predecessor: abort safely without deadlock
			if (
				current.status === ShipmentStatus.DELIVERED ||
				current.status === ShipmentStatus.CANCELLED ||
				current.status === ShipmentStatus.RETURNED
			) {
				console.log(
					`[Simulator:Guard] 🛑 Shipment [${current.trackingNumber}] is in terminal state '${current.status}'. Skipping update to ${targetStatus}.`,
				);
				return null;
			}

			if (expectedPreviousStatus && current.status !== expectedPreviousStatus) {
				console.warn(
					`[Simulator:Guard] ⚠️ Concurrency check: Shipment [${current.trackingNumber}] current status is '${current.status}', but expected predecessor is '${expectedPreviousStatus}'. Skipping transition to ${targetStatus}.`,
				);
				return null;
			}

			const courier =
				targetStatus === ShipmentStatus.PICKED_UP
					? current.pickupCourier || current.deliveryCourier
					: current.deliveryCourier || current.pickupCourier;

			const stepConfig = Object.values(STATUS_PROGRESSION).find(
				(s) => s?.next === targetStatus,
			);

			const eventDescription = stepConfig
				? stepConfig.description({
						courier: courier?.name,
						senderZone: current.senderZone.name,
						receiverZone: current.receiverZone.name,
					})
				: `Shipment status updated to ${targetStatus}`;

			const updated = await tx.shipment.update({
				where: { id: shipmentId },
				data: {
					status: targetStatus,
					events: {
						create: {
							status: targetStatus,
							description: eventDescription,
						},
					},
				},
				include: {
					senderZone: true,
					receiverZone: true,
					pickupCourier: true,
					deliveryCourier: true,
				},
			});

			return { updated, eventDescription, courierName: courier?.name || null };
		});

		if (!updatedShipment) {
			return null;
		}

		const { updated, eventDescription, courierName } = updatedShipment;
		console.log(
			`[Simulator:DB] ✅ Updated Shipment [${updated.trackingNumber}] to '${targetStatus}'. Event: "${eventDescription}"`,
		);

		// 2. Courier status update executed INDEPENDENTLY after the shipment transaction commits.
		// This completely eliminates the classic AB-BA lock inversion deadlock between
		// assignCourier (locks Courier -> Shipment) and processSimulatedStatusUpdate (locks Shipment -> Courier).
		if (targetStatus === ShipmentStatus.DELIVERED) {
			const couriersToCheck = Array.from(
				new Set(
					[updated.pickupCourierId, updated.deliveryCourierId].filter(
						Boolean,
					) as string[],
				),
			);

			for (const courierId of couriersToCheck) {
				try {
					console.log(
						`[Simulator:Courier] Checking courier [${courierId}] for active shipments remaining...`,
					);
					const activeCount = await prisma.shipment.count({
						where: {
							OR: [
								{ pickupCourierId: courierId },
								{ deliveryCourierId: courierId },
							],
							status: {
								in: [
									ShipmentStatus.COURIER_ASSIGNED,
									ShipmentStatus.PICKED_UP,
									ShipmentStatus.IN_TRANSIT,
									ShipmentStatus.OUT_FOR_DELIVERY,
								],
							},
							id: { not: shipmentId },
						},
					});

					if (activeCount === 0) {
						await prisma.courier.update({
							where: { id: courierId },
							data: { status: CourierStatus.AVAILABLE },
						});
						console.log(
							`[Simulator:Courier] ✅ Courier [${courierId}] has 0 remaining active shipments. Status reverted to AVAILABLE.`,
						);
					} else {
						console.log(
							`[Simulator:Courier] ℹ️ Courier [${courierId}] has ${activeCount} other active shipments. Keeping status BUSY.`,
						);
					}
				} catch (courierErr) {
					console.error(
						`[Simulator:Courier:Error] ❌ Error updating courier [${courierId}] availability:`,
						courierErr,
					);
				}
			}
		}

		// 3. Emit live real-time update via Socket.io
		emitShipmentStatusUpdate(updated.trackingNumber, {
			shipmentId: updated.id,
			trackingNumber: updated.trackingNumber,
			status: targetStatus,
			description: eventDescription,
			timestamp: new Date().toISOString(),
			senderZone: updated.senderZone.name,
			receiverZone: updated.receiverZone.name,
			courierName,
		});

		console.log(
			`[Simulator:Socket] 📡 Broadcasted status update for [${updated.trackingNumber}] (${targetStatus}) to tracking room`,
		);

		// 4. Schedule the next step in the progression or celebrate completion
		if (targetStatus === ShipmentStatus.DELIVERED) {
			console.log(
				`[Simulator:Complete] 🎉 Shipment [${updated.trackingNumber}] has reached final status DELIVERED. Simulation complete!`,
			);
		} else {
			await scheduleShipmentSimulation(
				shipmentId,
				targetStatus,
				updated.trackingNumber,
			);
		}

		return updated;
	} catch (error) {
		console.error(
			`[Simulator:Error] 💥 Unhandled exception during simulation update for Shipment [${shipmentId}] -> ${targetStatus}:`,
			error,
		);
		throw error;
	} finally {
		inFlightSimulations.delete(lockKey);
	}
};
