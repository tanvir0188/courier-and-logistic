import type { NextFunction, Request, Response } from "express";

export const requestLogger = (
	req: Request,
	res: Response,
	next: NextFunction,
) => {
	const start = Date.now();

	res.on("finish", () => {
		const duration = Date.now() - start;
		const statusCode = res.statusCode;
		const successStatus = statusCode >= 200 && statusCode < 400;
		const timestamp = new Date().toISOString();
		const url = req.originalUrl || req.url;
		const method = req.method;

		console.log(
			`[${timestamp}] ${method} ${url} | Status: ${statusCode} | Success: ${successStatus} | Duration: ${duration}ms`,
		);
	});

	next();
};
