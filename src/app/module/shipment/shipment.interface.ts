import type { ShipmentStatus } from "../../../generated/prisma/enums";

export interface ICreateShipmentPayload {
	providerId: string;
	senderZoneId: string;
	receiverZoneId: string;
	senderName: string;
	senderPhone: string;
	senderAddress: string;
	receiverName: string;
	receiverPhone: string;
	receiverAddress: string;
	parcelDescription?: string;
	weight: number;
	quantity?: number;
	deliveryFee?: number;
	totalAmount?: number;
}

export interface IShipmentFilterRequest {
	searchTerm?: string;
	shipmentId?: string;
	trackingNumber?: string;
	email?: string;
	customerEmail?: string;
	providerEmail?: string;
	zoneName?: string;
	senderZoneId?: string;
	receiverZoneId?: string;
	customerId?: string;
	providerId?: string;
	status?: ShipmentStatus;
	page?: number | string;
	limit?: number | string;
	sortBy?: string;
	sortOrder?: "asc" | "desc";
}

export interface IAssignCourierPayload {
	courierId?: string;
	pickupCourierId?: string;
	deliveryCourierId?: string;
}
