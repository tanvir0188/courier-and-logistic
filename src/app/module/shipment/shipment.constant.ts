import { ShipmentStatus } from "../../../generated/prisma/enums";

export const STATUS_SEQUENCE: Record<ShipmentStatus, number> = {
	[ShipmentStatus.CREATED]: 0,
	[ShipmentStatus.PAYMENT_CONFIRMED]: 1,
	[ShipmentStatus.COURIER_ASSIGNED]: 2,
	[ShipmentStatus.PICKED_UP]: 3,
	[ShipmentStatus.IN_TRANSIT]: 4,
	[ShipmentStatus.OUT_FOR_DELIVERY]: 5,
	[ShipmentStatus.DELIVERED]: 6,
	[ShipmentStatus.DELIVERY_FAILED]: 99,
	[ShipmentStatus.RETURNED]: 99,
	[ShipmentStatus.CANCELLED]: 99,
};
