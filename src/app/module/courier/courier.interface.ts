import type { CourierStatus } from "../../../generated/prisma/enums";

export interface ICreateCourierPayload {
	name: string;
	phone: string;
	zoneId: string;
	status?: CourierStatus;
}

export interface IUpdateCourierPayload {
	name?: string;
	phone?: string;
	zoneId?: string;
	status?: CourierStatus;
}

export interface ICourierFilterRequest {
	searchTerm?: string;
	status?: CourierStatus;
	zoneId?: string;
	providerId?: string;
	page?: number | string;
	limit?: number | string;
	sortBy?: string;
	sortOrder?: "asc" | "desc";
}
