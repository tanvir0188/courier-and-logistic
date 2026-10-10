import http from "node:http";
import app from "./app";
import config from "./app/config";

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

const PORT = config.port;

const main = async () => {
	try {
		await prisma.$connect();
		console.log("Connected to the database successfully.");

		await redisClient.ping();
		redisClient.set("test", "test");
		redisClient.get("test").then(console.log);
		console.log("Redis Connected Successfully.");

		await transporter.verify();
		console.log("Nodemailer Connected Successfully.");

		await seedSuperAdmin();
		await seedTesterAdmin();
		await seedTesterProvider();

		const httpServer = http.createServer(app);
		initSocket(httpServer);

		httpServer.listen(PORT, () => {
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
