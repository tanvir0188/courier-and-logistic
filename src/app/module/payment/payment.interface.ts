import type {
	PaymentGateway,
	PaymentStatus,
} from "../../../generated/prisma/enums";

export interface ICreateCheckoutSessionPayload {
	shipmentId: string;
	successUrl?: string;
	cancelUrl?: string;
}

export interface IVerifySessionPayload {
	sessionId: string;
}

export interface IPaymentFilterRequest {
	searchTerm?: string;
	transactionId?: string;
	shipmentId?: string;
	customerName?: string;
	customerEmail?: string;
	status?: PaymentStatus;
	gateway?: PaymentGateway;
	page?: number | string;
	limit?: number | string;
	sortBy?: string;
	sortOrder?: "asc" | "desc";
}
