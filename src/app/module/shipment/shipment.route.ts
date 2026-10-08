import { Router } from "express";
import { Role } from "../../../generated/prisma/enums";
import { auth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { ShipmentController } from "./shipment.controller";
import { ShipmentValidation } from "./shipment.validation";

const router = Router();

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

// Get available couriers to assign for a shipment
router.get(
	"/:id/available-couriers",
	auth(Role.PROVIDER, Role.ADMIN),
	ShipmentController.getAvailableCouriersForShipment,
);

// Assign courier(s) to shipment
router.patch(
	"/:id/assign-courier",
	auth(Role.PROVIDER, Role.ADMIN),
	validateRequest(ShipmentValidation.assignCourierZodSchema),
	ShipmentController.assignCourier,
);

// QStash webhook / Background task simulation endpoint
router.post("/simulate-status-update", ShipmentController.simulateStatusUpdate);

export const ShipmentRoutes = router;
