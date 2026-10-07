import z from "zod";

const createZoneZodSchema = z.object({
	name: z
		.string({
			error: "Zone name must be a string",
		})
		.min(2, "Zone name must be at least 2 characters long")
		.max(100, "Zone name must be at most 100 characters long"),
});

const updateZoneZodSchema = z.object({
	name: z
		.string({
			error: "Zone name must be a string",
		})
		.min(2, "Zone name must be at least 2 characters long")
		.max(100, "Zone name must be at most 100 characters long"),
});

export const ZoneValidation = {
	createZoneZodSchema,
	updateZoneZodSchema,
};
