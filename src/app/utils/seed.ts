import bcrypt from "bcryptjs";
import httpStatus from "http-status";
import { Role } from "../../generated/prisma/enums";
import config from "../config";
import { prisma } from "../lib/prisma";
import { AppError } from "./AppError";

export const seedSuperAdmin = async () => {
	try {
		const isAdminExist = await prisma.user.findFirst({
			where: {
				role: Role.ADMIN,
			},
		});

		if (isAdminExist) {
			console.log("Admin Already Exists!");
			return;
		}

		const name = config.super_admin_name || "Admin";
		const email = config.super_admin_email;
		const password = config.super_admin_password;

		if (!name || !email || !password) {
			return;
		}

		const hashedPassword = await bcrypt.hash(
			password,
			Number(config.bcrypt_salt_rounds) || 10,
		);

		const admin = await prisma.user.create({
			data: {
				name,
				email,
				passwordHash: hashedPassword,
				role: Role.ADMIN,
				isActive: true,
			},
		});

		console.log("Admin Created : ", admin);
	} catch (error) {
		console.log("Error Seeding Admin : ", error);

		if (config.super_admin_email) {
			await prisma.user.delete({
				where: {
					email: config.super_admin_email,
				},
			}).catch(() => {});
		}
	}
};

//create tester admin
export const seedTesterAdmin = async () => {
	try {
		if (!config.tester_admin_email) return;

		const isTesterAdminExist = await prisma.user.findUnique({
			where: {
				email: config.tester_admin_email,
			},
		});

		if (isTesterAdminExist) {
			console.log("Tester Admin Already Exists!");
			return;
		}

		const name = config.tester_admin_name || "Tester Admin";
		const email = config.tester_admin_email;
		const password = config.tester_admin_password;

		if (!name || !email || !password) {
			return;
		}

		const hashedPassword = await bcrypt.hash(
			password,
			Number(config.bcrypt_salt_rounds) || 10,
		);

		const testerAdmin = await prisma.user.create({
			data: {
				name,
				email,
				passwordHash: hashedPassword,
				role: Role.ADMIN,
				isActive: true,
			},
		});

		console.log("Tester Admin Created : ", testerAdmin);
	} catch (error) {
		console.log("Error Seeding Tester Admin : ", error);

		if (config.tester_admin_email) {
			await prisma.user.delete({
				where: {
					email: config.tester_admin_email,
				},
			}).catch(() => {});
		}
	}
};
