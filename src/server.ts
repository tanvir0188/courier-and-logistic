import http from "node:http";
import app from "./app";
import config from "./app/config";

import { transporter } from "./app/lib/nodemailer";
import { prisma } from "./app/lib/prisma";
import { redisClient } from "./app/lib/redis";
import {
	seedSuperAdmin,
	seedTesterAdmin,
	seedTesterProvider,
} from "./app/utils/seed";
import { initSocket } from "./app/lib/socket";

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
		});
	} catch (error) {
		console.error("Error starting the server:", error);
		await prisma.$disconnect();
		process.exit(1);
	}
};

main();
