import type { Server as HttpServer } from "node:http";
import { Server as SocketIOServer, type Socket } from "socket.io";
import type { ShipmentStatus } from "../../generated/prisma/enums";

let io: SocketIOServer | null = null;

export interface IShipmentStatusUpdateEvent {
	shipmentId: string;
	trackingNumber: string;
	status: ShipmentStatus;
	description: string;
	timestamp: Date | string;
	senderZone?: string;
	receiverZone?: string;
	courierName?: string | null;
}

export const initSocket = (httpServer: HttpServer): SocketIOServer => {
	io = new SocketIOServer(httpServer, {
		cors: {
			origin: [
				"http://localhost:3000",
				"http://127.0.0.1:3000",
				process.env.FRONTEND_URL || "",
			].filter(Boolean),
			methods: ["GET", "POST", "PATCH", "PUT", "DELETE"],
			credentials: true,
		},
		transports: ["websocket", "polling"],
	});

	io.on("connection", (socket: Socket) => {
		console.log(`[Socket.io] Client connected: ${socket.id}`);

		// Client joins a room for a specific shipment by tracking number
		socket.on("join:shipment", (trackingNumber: string) => {
			if (typeof trackingNumber === "string" && trackingNumber.trim()) {
				const cleanTrackingNumber = trackingNumber.trim().toUpperCase();
				const room = `shipment:${cleanTrackingNumber}`;
				socket.join(room);
				console.log(`[Socket.io] Client ${socket.id} joined room ${room}`);
				socket.emit("joined:shipment", {
					room,
					trackingNumber: cleanTrackingNumber,
					message: `Subscribed to live tracking updates for ${cleanTrackingNumber}`,
				});
			}
		});

		// Client leaves tracking room
		socket.on("leave:shipment", (trackingNumber: string) => {
			if (typeof trackingNumber === "string" && trackingNumber.trim()) {
				const cleanTrackingNumber = trackingNumber.trim().toUpperCase();
				const room = `shipment:${cleanTrackingNumber}`;
				socket.leave(room);
				console.log(`[Socket.io] Client ${socket.id} left room ${room}`);
			}
		});

		socket.on("disconnect", () => {
			console.log(`[Socket.io] Client disconnected: ${socket.id}`);
		});
	});

	return io;
};

export const getIO = (): SocketIOServer | null => {
	return io;
};

export const emitShipmentStatusUpdate = (
	trackingNumber: string,
	data: IShipmentStatusUpdateEvent,
) => {
	if (!io) {
		console.warn(
			"[Socket.io] Cannot emit update: Socket.io is not initialized yet",
		);
		return;
	}

	const cleanTrackingNumber = trackingNumber.trim().toUpperCase();
	const room = `shipment:${cleanTrackingNumber}`;

	// Emit to room for this tracking number
	io.to(room).emit("shipment:status_updated", data);

	// Also emit to general shipment update channel for provider/admin dashboards
	io.emit("shipment:live_update", data);
	console.log(
		`[Socket.io] Emitted status update for ${cleanTrackingNumber} -> ${data.status}`,
	);
};
