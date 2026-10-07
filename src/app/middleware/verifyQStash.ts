import type { NextFunction, Request, Response } from "express";
import httpStatus from "http-status";
import { qstashReceiver } from "../lib/qstash";
import { AppError } from "../utils/AppError";

export const verifyQStash = async (
	req: Request,
	_res: Response,
	next: NextFunction,
) => {
	const signature = req.headers["upstash-signature"] as string | undefined;

	if (!signature) {
		return next(
			new AppError(
				httpStatus.UNAUTHORIZED,
				"Missing Upstash QStash signature header",
			),
		);
	}

	try {
		const rawBody =
			typeof req.body === "string" ? req.body : JSON.stringify(req.body);

		const isValid = await qstashReceiver.verify({
			signature,
			body: rawBody,
		});

		if (!isValid) {
			return next(
				new AppError(httpStatus.UNAUTHORIZED, "Invalid QStash signature"),
			);
		}

		next();
	} catch {
		next(new AppError(httpStatus.UNAUTHORIZED, "QStash signature verification failed"));
	}
};
