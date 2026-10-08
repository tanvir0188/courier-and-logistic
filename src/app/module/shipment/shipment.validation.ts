import z from "zod";

const createShipmentZodSchema = z.object({
	providerId: z
		.string({
			error: "Provider ID must be a string",
		})
		.uuid("Provider ID must be a valid UUID"),
	senderZoneId: z
		.string({
			error: "Sender Zone ID must be a string",
		})
		.uuid("Sender Zone ID must be a valid UUID"),
	receiverZoneId: z
		.string({
			error: "Receiver Zone ID must be a string",
		})
		.uuid("Receiver Zone ID must be a valid UUID"),
	senderName: z
		.string({
			error: "Sender name must be a string",
		})
		.min(2, "Sender name must be at least 2 characters long")
		.max(100, "Sender name must be at most 100 characters long"),
	senderPhone: z
		.string({
			error: "Sender phone must be a string",
		})
		.min(6, "Sender phone must be at least 6 characters long")
		.max(20, "Sender phone must be at most 20 characters long"),
	senderAddress: z
		.string({
			error: "Sender address must be a string",
		})
		.min(5, "Sender address must be at least 5 characters long")
		.max(300, "Sender address must be at most 300 characters long"),
	receiverName: z
		.string({
			error: "Receiver name must be a string",
		})
		.min(2, "Receiver name must be at least 2 characters long")
		.max(100, "Receiver name must be at most 100 characters long"),
	receiverPhone: z
		.string({
			error: "Receiver phone must be a string",
		})
		.min(6, "Receiver phone must be at least 6 characters long")
		.max(20, "Receiver phone must be at most 20 characters long"),
	receiverAddress: z
		.string({
			error: "Receiver address must be a string",
		})
		.min(5, "Receiver address must be at least 5 characters long")
		.max(300, "Receiver address must be at most 300 characters long"),
	parcelDescription: z
		.string()
		.max(500, "Parcel description must be at most 500 characters long")
		.optional(),
	weight: z
		.number({
			error: "Weight must be a number",
		})
		.positive("Weight must be greater than 0"),
	quantity: z
		.number()
		.int("Quantity must be an integer")
		.positive("Quantity must be at least 1")
		.optional(),
	deliveryFee: z
		.number()
		.nonnegative("Delivery fee must be 0 or greater")
		.optional(),
	totalAmount: z
		.number()
		.nonnegative("Total amount must be 0 or greater")
		.optional(),
});

const assignCourierZodSchema = z
	.object({
		courierId: z
			.string({
				error: "Courier ID must be a string",
			})
			.uuid("Courier ID must be a valid UUID")
			.optional(),
		pickupCourierId: z
			.string({
				error: "Pickup Courier ID must be a string",
			})
			.uuid("Pickup Courier ID must be a valid UUID")
			.optional(),
		deliveryCourierId: z
			.string({
				error: "Delivery Courier ID must be a string",
			})
			.uuid("Delivery Courier ID must be a valid UUID")
			.optional(),
	})
	.refine(
		(data) =>
			Boolean(data.courierId || data.pickupCourierId || data.deliveryCourierId),
		{
			message:
				"At least one of courierId, pickupCourierId, or deliveryCourierId must be provided",
		},
	);

export const ShipmentValidation = {
	createShipmentZodSchema,
	assignCourierZodSchema,
};
