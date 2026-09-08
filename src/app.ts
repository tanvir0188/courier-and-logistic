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
import { getBkashIdToken } from "./app/lib/bkash";
import { globalErrorHandler } from "./app/middleware/globalErrorHandler";
import { notFound } from "./app/middleware/notFound";
import { AuthRoutes } from "./app/module/auth/auth.route";
import { UserRoutes } from "./app/module/user/user.route";
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

app.get("/test", async (req: Request, res: Response, next: NextFunction) => {
	try {
		const grantIdTokenResult = await getBkashIdToken();

		console.log(grantIdTokenResult);

		res.status(httpStatus.OK).json({
			success: true,
			message: "Welcome to PH Healthcare System Backend",
			data: null,
		});
	} catch (error) {
		console.log(error);
		next(error);
	}
});

// Basic route
app.get("/", async (req: Request, res: Response) => {
	res.status(httpStatus.OK).json({
		success: true,
		message: "Welcome to PH Healthcare System Backend",
	});
});
app.get("/google-login-test", (req: Request, res: Response) => {
	res.sendFile(path.join(__dirname, '../../google-login-test.html'))
});

app.use(globalErrorHandler);
app.use(notFound);

export default app;
