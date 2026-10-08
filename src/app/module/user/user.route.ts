import { Router } from "express";
import { Role } from "../../../generated/prisma/enums";
import { upload } from "../../lib/multer";
import { auth } from "../../middleware/checkAuth";
import { UserController } from "./user.controller";

const router = Router();

router.patch(
	"/profile",
	auth(Role.ADMIN, Role.CUSTOMER, Role.PROVIDER),
	upload.single("profilePic"),
	UserController.updateProfile,
);

router.get("/", auth(Role.ADMIN), UserController.getUsers);

export const UserRoutes = router;
