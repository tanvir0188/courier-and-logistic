import { Router } from "express";
import { Role } from "../../../generated/prisma/enums";
import { auth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { ZoneController } from "./zone.controller";
import { ZoneValidation } from "./zone.validation";

const router = Router();

// Only Provider can create, update, or delete zones
router.post(
	"/",
	auth(Role.PROVIDER),
	validateRequest(ZoneValidation.createZoneZodSchema),
	ZoneController.createZone,
);

router.get(
	"/",
	auth(Role.PROVIDER, Role.ADMIN, Role.CUSTOMER),
	ZoneController.getAllZones,
);

router.get(
	"/:id",
	auth(Role.PROVIDER, Role.ADMIN, Role.CUSTOMER),
	ZoneController.getZoneById,
);

router.patch(
	"/:id",
	auth(Role.PROVIDER),
	validateRequest(ZoneValidation.updateZoneZodSchema),
	ZoneController.updateZone,
);

router.delete(
	"/:id",
	auth(Role.PROVIDER),
	ZoneController.deleteZone,
);

export const ZoneRoutes = router;
