import { Router } from "express";
import { Role } from "../../../generated/prisma/enums";
import { auth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { CourierController } from "./courier.controller";
import { CourierValidation } from "./courier.validation";

const router = Router();

// Only Provider can create, update, or delete couriers
router.post(
	"/",
	auth(Role.PROVIDER),
	validateRequest(CourierValidation.createCourierZodSchema),
	CourierController.createCourier,
);

router.get(
	"/",
	auth(Role.PROVIDER, Role.ADMIN),
	CourierController.getAllCouriers,
);

router.get(
	"/:id",
	auth(Role.PROVIDER, Role.ADMIN),
	CourierController.getCourierById,
);

router.patch(
	"/:id",
	auth(Role.PROVIDER),
	validateRequest(CourierValidation.updateCourierZodSchema),
	CourierController.updateCourier,
);

router.delete(
	"/:id",
	auth(Role.PROVIDER),
	CourierController.deleteCourier,
);

export const CourierRoutes = router;
