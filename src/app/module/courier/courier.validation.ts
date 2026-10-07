import z from "zod";
import { CourierStatus } from "../../../generated/prisma/enums";

const createCourierZodSchema = z.object({
	name: z
		.string({
			error: "Courier name must be a string",
		})
		.min(2, "Courier name must be at least 2 characters long")
		.max(100, "Courier name must be at most 100 characters long"),
	phone: z
		.string({
			error: "Phone must be a string",
		})
		.min(6, "Phone must be at least 6 characters long")
		.max(20, "Phone must be at most 20 characters long"),
	zoneId: z
		.string({
			error: "Zone ID must be a string",
		})
		.uuid("Zone ID must be a valid UUID"),
	status: z
		.nativeEnum(CourierStatus)
		.optional(),
});

const updateCourierZodSchema = z.object({
	name: z
		.string()
		.min(2, "Courier name must be at least 2 characters long")
		.max(100, "Courier name must be at most 100 characters long")
		.optional(),
	phone: z
		.string()
		.min(6, "Phone must be at least 6 characters long")
		.max(20, "Phone must be at most 20 characters long")
		.optional(),
	zoneId: z
		.string()
		.uuid("Zone ID must be a valid UUID")
		.optional(),
	status: z
		.nativeEnum(CourierStatus)
		.optional(),
});

export const CourierValidation = {
	createCourierZodSchema,
	updateCourierZodSchema,
};
