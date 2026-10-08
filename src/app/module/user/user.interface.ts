import { Role } from "../../../generated/prisma/enums";

export interface IUpdateProfilePayload {
    name?: string;
    phone?: string;
    profilePic?: string;
}

export interface IUserFilterRequest {
    searchTerm?: string;
    name?: string;
    email?: string;
    role?: Role;
    isActive?: boolean | string;
    page?: number | string;
    limit?: number | string;
    sortBy?: string;
    sortOrder?: "asc" | "desc";
}