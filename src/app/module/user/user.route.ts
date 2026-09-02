import { Router } from "express";
import { Role } from "../../../generated/prisma/enums";
import { upload } from "../../lib/multer";
import { auth } from "../../middleware/checkAuth";
import { UserController } from "./user.controller";

const router = Router();

router.patch(
	"/profile-image",
	auth(Role.SUPER_ADMIN, Role.ADMIN, Role.CUSTOMER, Role.COURIER, Role.HUB_MANAGER, Role.OPS_MANAGER),
	upload.single("profileImage"),
	UserController.uploadProfileImage,
);

export const UserRoutes = router;
