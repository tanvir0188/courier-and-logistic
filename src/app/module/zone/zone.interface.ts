export interface ICreateZonePayload {
	name: string;
}

export interface IUpdateZonePayload {
	name: string;
}

export interface IZoneFilterRequest {
	searchTerm?: string;
	page?: number | string;
	limit?: number | string;
	sortBy?: string;
	sortOrder?: "asc" | "desc";
}
