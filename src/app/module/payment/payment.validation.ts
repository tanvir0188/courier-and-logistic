import z from "zod";

const createCheckoutSessionZodSchema = z.object({
	shipmentId: z
		.string({
			error: "Shipment ID must be a string",
		})
		.uuid("Shipment ID must be a valid UUID"),
	successUrl: z.string().url("Success URL must be a valid URL").optional(),
	cancelUrl: z.string().url("Cancel URL must be a valid URL").optional(),
});

const verifySessionZodSchema = z.object({
	sessionId: z
		.string({
			error: "Session ID must be a string",
		})
		.min(1, "Session ID is required"),
});

export const PaymentValidation = {
	createCheckoutSessionZodSchema,
	verifySessionZodSchema,
};
