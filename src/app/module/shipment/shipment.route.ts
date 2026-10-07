import { Router } from "express";
import { Role } from "../../../generated/prisma/enums";
import { auth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { ShipmentController } from "./shipment.controller";
import { ShipmentValidation } from "./shipment.validation";

const router = Router();

// Only Customers can create shipments
router.post(
	"/",
	auth(Role.CUSTOMER),
	validateRequest(ShipmentValidation.createShipmentZodSchema),
	ShipmentController.createShipment,
);

// Read shipments (Customer sees only their own, Provider sees only their own, Admin sees all)
router.get(
	"/",
	auth(Role.CUSTOMER, Role.PROVIDER, Role.ADMIN),
	ShipmentController.getAllShipments,
);

// Track shipment by tracking number
router.get(
	"/track/:trackingNumber",
	auth(Role.CUSTOMER, Role.PROVIDER, Role.ADMIN),
	ShipmentController.trackShipment,
);

// Get shipment by ID
router.get(
	"/:id",
	auth(Role.CUSTOMER, Role.PROVIDER, Role.ADMIN),
	ShipmentController.getShipmentById,
);

export const ShipmentRoutes = router;
