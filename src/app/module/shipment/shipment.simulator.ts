import { CourierStatus, ShipmentStatus } from "../../../generated/prisma/enums";
import config from "../../config";
import { prisma } from "../../lib/prisma";
import { publishTask, type QStashDelay } from "../../lib/qstash";
import { emitShipmentStatusUpdate } from "../../lib/socket";
import { STATUS_SEQUENCE } from "./shipment.constant";

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
// In-memory map to track active local timers
const activeTimers = new Map<string, NodeJS.Timeout>();

export const scheduleShipmentSimulation = async (
	shipmentId: string,
	currentStatus: ShipmentStatus,
	trackingNumber?: string,
	delaySeconds: number = 20,
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
	const delay = Math.max(1, delaySeconds);
	const backendUrl = config.bak_url;
	const isLocalhost =
		!backendUrl ||
		backendUrl.includes("localhost") ||
		backendUrl.includes("127.0.0.1");

	let publishedToQStash = false;

	if (!isLocalhost) {
		const targetUrl = `${backendUrl}/api/v1/shipment/simulate-status-update`;
		console.log(
			`[Simulator:QStash] 🚀 Publishing task for Shipment [${trackingTag}] -> Next: ${nextStatus} (delay: ${delay}s) to ${targetUrl}`,
		);
		try {
			await publishTask({
				url: targetUrl,
				body: {
					shipmentId,
					nextStatus,
				},
				delay: `${delay}s` as unknown as QStashDelay,
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

	// In local development (localhost) or when QStash fails, use setTimeout simulation
	if (!publishedToQStash) {
		const timerKey = `${shipmentId}:${nextStatus}`;
		const existingTimer = activeTimers.get(timerKey);
		if (existingTimer) {
			clearTimeout(existingTimer);
		}

		console.log(
			`[Simulator:LocalTimer] ⏱️ Scheduled ${delay}-second timer for Shipment [${trackingTag}]: Current=${currentStatus} -> Next=${nextStatus}`,
		);
		const timer = setTimeout(async () => {
			activeTimers.delete(timerKey);
			try {
				await processSimulatedStatusUpdate(shipmentId, nextStatus);
			} catch (err) {
				console.error(
					`[Simulator:LocalTimer:Error] ❌ Error during local simulation step for Shipment [${trackingTag}] -> ${nextStatus}:`,
					err,
				);
			}
		}, delay * 1000);

		activeTimers.set(timerKey, timer);
	}
};

export const processSimulatedStatusUpdate = async (
	shipmentId: string,
	targetStatus: ShipmentStatus,
) => {
	const lockKey = `${shipmentId}:${targetStatus}`;

	const existingLockTimer = activeTimers.get(lockKey);
	if (existingLockTimer) {
		clearTimeout(existingLockTimer);
		activeTimers.delete(lockKey);
	}

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
		const updatedShipment = await prisma.$transaction(
			async (tx) => {
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

				// IDEMPOTENCY CHECK:
				// If an event for targetStatus already exists, or shipment has already reached/passed targetStatus, do not update DB!
				const existingEvent = await tx.shipmentEvent.findFirst({
					where: {
						shipmentId,
						status: targetStatus,
					},
				});

				if (
					existingEvent ||
					STATUS_SEQUENCE[current.status] >= STATUS_SEQUENCE[targetStatus]
				) {
					console.log(
						`[Simulator:Idempotency] 🛑 Shipment [${current.trackingNumber}] already has event for '${targetStatus}' or status is '${current.status}'. Skipping DB update.`,
					);
					return null;
				}

				if (
					expectedPreviousStatus &&
					current.status !== expectedPreviousStatus
				) {
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

				return {
					updated,
					eventDescription,
					courierName: courier?.name || null,
				};
			},
			{
				maxWait: 10000,
				timeout: 20000,
			},
		);

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

/**
 * Recovers and resumes all active shipments that were interrupted by a system restart,
 * server crash, or network timeout.
 *
 * Scans for shipments currently in non-terminal progression statuses:
 * - COURIER_ASSIGNED -> will progress to PICKED_UP
 * - PICKED_UP -> will progress to IN_TRANSIT
 * - IN_TRANSIT -> will progress to OUT_FOR_DELIVERY
 * - OUT_FOR_DELIVERY -> will progress to DELIVERED
 */
export const resumeInterruptedShipments = async () => {
	const activeStatuses = [
		ShipmentStatus.COURIER_ASSIGNED,
		ShipmentStatus.PICKED_UP,
		ShipmentStatus.IN_TRANSIT,
		ShipmentStatus.OUT_FOR_DELIVERY,
	];

	try {
		console.log(
			"[Simulator:Recovery] 🔍 Scanning database for interrupted shipments...",
		);

		const interruptedShipments = await prisma.shipment.findMany({
			where: {
				status: {
					in: activeStatuses,
				},
			},
			include: {
				events: {
					orderBy: {
						createdAt: "desc",
					},
					take: 1,
				},
			},
			orderBy: {
				updatedAt: "asc",
			},
		});

		if (interruptedShipments.length === 0) {
			console.log(
				"[Simulator:Recovery] ✅ No interrupted shipments found. All shipments up to date.",
			);
			return 0;
		}

		console.log(
			`[Simulator:Recovery] 🔄 Found ${interruptedShipments.length} active shipment(s) to evaluate/resume.`,
		);

		let resumedCount = 0;

		for (let i = 0; i < interruptedShipments.length; i++) {
			const shipment = interruptedShipments[i];
			const nextStep = STATUS_PROGRESSION[shipment.status];

			if (!nextStep) {
				continue;
			}

			const lockKey = `${shipment.id}:${nextStep.next}`;
			if (inFlightSimulations.has(lockKey) || activeTimers.has(lockKey)) {
				continue;
			}

			// Calculate time elapsed since the latest event or last update
			const lastUpdate = shipment.events[0]?.createdAt || shipment.updatedAt;
			const elapsedMs = Date.now() - new Date(lastUpdate).getTime();
			const standardIntervalMs = 20000; // 20s interval

			let delaySeconds: number;
			if (elapsedMs >= standardIntervalMs) {
				// Overdue due to restart/crash: stagger execution by 2 seconds each to prevent DB thundering herd
				delaySeconds = Math.min(2 + resumedCount * 2, 30);
			} else {
				// Remaining time from the scheduled window
				const remainingSeconds = Math.ceil(
					(standardIntervalMs - elapsedMs) / 1000,
				);
				delaySeconds = Math.max(2, remainingSeconds);
			}

			console.log(
				`[Simulator:Recovery] ▶️ Resuming Shipment [${shipment.trackingNumber}]: '${shipment.status}' -> '${nextStep.next}' in ${delaySeconds}s (Elapsed: ${Math.round(elapsedMs / 1000)}s)`,
			);

			await scheduleShipmentSimulation(
				shipment.id,
				shipment.status,
				shipment.trackingNumber,
				delaySeconds,
			);

			resumedCount++;
		}

		console.log(
			`[Simulator:Recovery] 🚀 Evaluated ${interruptedShipments.length} shipments, scheduled ${resumedCount} resumption task(s).`,
		);
		return resumedCount;
	} catch (error) {
		console.error(
			"[Simulator:Recovery:Error] ❌ Failed to scan and resume interrupted shipments:",
			error,
		);
		return 0;
	}
};

/**
 * Scans the database for existing duplicate shipment events (same shipment_id and status),
 * preserves the earliest event, and removes redundant duplicate events.
 */
export const deduplicateShipmentEvents = async () => {
	try {
		const duplicates = await prisma.$queryRaw<
			Array<{
				shipment_id: string;
				status: ShipmentStatus;
				count: number | bigint;
			}>
		>`
			SELECT shipment_id, status, count(*) 
			FROM shipment_events 
			GROUP BY shipment_id, status 
			HAVING count(*) > 1
		`;

		if (!duplicates || duplicates.length === 0) {
			return 0;
		}

		console.log(
			`[Deduplicate] Found ${duplicates.length} duplicate event group(s) in database. Cleaning up...`,
		);

		let deletedCount = 0;
		for (const dup of duplicates) {
			const events = await prisma.shipmentEvent.findMany({
				where: {
					shipmentId: dup.shipment_id,
					status: dup.status,
				},
				orderBy: {
					createdAt: "asc",
				},
			});

			// Keep the earliest one, delete any later duplicates
			const duplicatesToDelete = events.slice(1).map((e) => e.id);
			if (duplicatesToDelete.length > 0) {
				const result = await prisma.shipmentEvent.deleteMany({
					where: {
						id: { in: duplicatesToDelete },
					},
				});
				deletedCount += result.count;
				console.log(
					`[Deduplicate] ✅ Deleted ${result.count} duplicate '${dup.status}' event(s) for shipment ${dup.shipment_id}.`,
				);
			}
		}

		return deletedCount;
	} catch (err) {
		console.error(
			"[Deduplicate:Error] Failed to clean up duplicate events:",
			err,
		);
		return 0;
	}
};
