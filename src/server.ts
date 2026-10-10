import dns from "node:dns";
import http from "node:http";
import app from "./app";
import config from "./app/config";

// Prefer IPv4 DNS results to prevent IPv6 ENETUNREACH in environments without IPv6 routing (e.g. Render)
dns.setDefaultResultOrder("ipv4first");

import { initCronJobs } from "./app/lib/cron";
import { transporter } from "./app/lib/nodemailer";
import { prisma } from "./app/lib/prisma";
import { redisClient } from "./app/lib/redis";
import { initSocket } from "./app/lib/socket";
import {
	deduplicateShipmentEvents,
	resumeInterruptedShipments,
} from "./app/module/shipment/shipment.simulator";
import {
	seedSuperAdmin,
	seedTesterAdmin,
	seedTesterProvider,
} from "./app/utils/seed";

const PORT = Number(config.port) || 5000;

const main = async () => {
	try {
		await prisma.$connect();
		console.log("Connected to the database successfully.");

		await redisClient.ping();
		redisClient.set("test", "test");
		redisClient.get("test").then(console.log);
		console.log("Redis Connected Successfully.");

		try {
			await transporter.verify();
			console.log("Nodemailer Connected Successfully.");
		} catch (smtpErr) {
			console.warn("⚠️ Nodemailer verification failed (emails may not send):", smtpErr);
		}

		await seedSuperAdmin();
		await seedTesterAdmin();
		await seedTesterProvider();

		const httpServer = http.createServer(app);
		initSocket(httpServer);

		httpServer.listen(PORT, "0.0.0.0", () => {
			console.log(`Server and Socket.io are running on port ${PORT}`);

			// Clean up any historical duplicate events from before idempotency was introduced
			deduplicateShipmentEvents().catch((err) => {
				console.error(
					"[Startup:Deduplicate:Error] Failed to clean up duplicate events:",
					err,
				);
			});

			// Initialize periodic cron watchdog
			initCronJobs();

			// Resume any shipment status update processes interrupted by system restart
			resumeInterruptedShipments().catch((err) => {
				console.error(
					"[Startup:Recovery:Error] Failed to resume shipments on boot:",
					err,
				);
			});
		});
	} catch (error) {
		console.error("Error starting the server:", error);
		await prisma.$disconnect();
		process.exit(1);
	}
};

main();
