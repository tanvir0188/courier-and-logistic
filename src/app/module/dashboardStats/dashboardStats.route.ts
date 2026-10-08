import { Router } from "express";
import { Role } from "../../../generated/prisma/enums";
import { auth } from "../../middleware/checkAuth";
import { DashboardStatsController } from "./dashboardStats.controller";

const router = Router();

router.get(
	"/",
	auth(Role.CUSTOMER, Role.PROVIDER, Role.ADMIN),
	DashboardStatsController.getDashboardStats,
);

export const DashboardStatsRoutes = router;
