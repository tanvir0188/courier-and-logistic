import cookieParser from "cookie-parser";
import cors from "cors";
import express, {
	type Application,
	type NextFunction,
	type Request,
	type Response,
} from "express";
import httpStatus from "http-status";
import config from "./app/config";
import { globalErrorHandler } from "./app/middleware/globalErrorHandler";
import { notFound } from "./app/middleware/notFound";
import { AuthRoutes } from "./app/module/auth/auth.route";
import { CourierRoutes } from "./app/module/courier/courier.route";
import { UserRoutes } from "./app/module/user/user.route";
import { ZoneRoutes } from "./app/module/zone/zone.route";
import path from "node:path";
import { requestLogger } from "./app/middleware/requestLogger";

const app: Application = express();

app.use(requestLogger);

app.use(
	cors({
		origin: "*",
		credentials: true,
	}),
);

// Enable URL-encoded form data parsing
app.use(express.urlencoded({ extended: true }));

// Middleware to parse JSON bodies
app.use(express.json());
app.use(cookieParser());

app.use("/api/v1/auth", AuthRoutes);
app.use("/api/v1/user", UserRoutes);
app.use("/api/v1/zone", ZoneRoutes);
app.use("/api/v1/courier", CourierRoutes);

app.get("/test", async (_req: Request, res: Response) => {
	res.status(httpStatus.OK).json({
		success: true,
		message: "Courier and Logistics Backend is healthy and running!",
		data: null,
	});
});

// Basic route
app.get("/", async (_req: Request, res: Response) => {
	res.status(httpStatus.OK).json({
		success: true,
		message: "Welcome to Courier and Logistics Service API",
	});
});
app.get("/google-login-test", (req: Request, res: Response) => {
	res.sendFile(path.join(__dirname, "../../google-login-test.html"));
});

app.use(globalErrorHandler);
app.use(notFound);

export default app;
