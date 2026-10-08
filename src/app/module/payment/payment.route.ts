import { Router } from "express";
import { Role } from "../../../generated/prisma/enums";
import { auth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { PaymentController } from "./payment.controller";
import { PaymentValidation } from "./payment.validation";

const router = Router();

// Create Stripe checkout session (Customers create for their own shipments, Admins for any)
router.post(
	"/create-checkout-session",
	auth(Role.CUSTOMER, Role.ADMIN),
	validateRequest(PaymentValidation.createCheckoutSessionZodSchema),
	PaymentController.createCheckoutSession,
);

// Verify checkout session status directly (called by frontend upon redirect)
router.post(
	"/verify-session",
	auth(Role.CUSTOMER, Role.PROVIDER, Role.ADMIN),
	validateRequest(PaymentValidation.verifySessionZodSchema),
	PaymentController.verifyCheckoutSession,
);

// Get payment record for a shipment
router.get(
	"/shipment/:shipmentId",
	auth(Role.CUSTOMER, Role.PROVIDER, Role.ADMIN),
	PaymentController.getPaymentByShipmentId,
);

// Get all payments (accessible to Provider and Admin only, scoped by role)
router.get(
	"/",
	auth(Role.PROVIDER, Role.ADMIN),
	PaymentController.getAllPayments,
);

// Stripe webhook receiver
router.post("/webhook", PaymentController.handleStripeWebhook);

export const PaymentRoutes = router;
