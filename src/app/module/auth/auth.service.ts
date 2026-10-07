/** biome-ignore-all lint/style/useConst: <explanation> */
import bcrypt from "bcryptjs";
import crypto from "crypto";
import ejs from "ejs";
import type { TokenPayload } from "google-auth-library";
import httpStatus from "http-status";
import type { JwtPayload, SignOptions } from "jsonwebtoken";
import path from "path";
import { Role } from "../../../generated/prisma/enums";
import config from "../../config";
import { googleClient } from "../../lib/googleAuth";
import { transporter } from "../../lib/nodemailer";
import { prisma } from "../../lib/prisma";
import { redisClient } from "../../lib/redis";
import { AppError } from "../../utils/AppError";
import { jwtUtils } from "../../utils/jwt";
import type {
	IForgotPasswordPayload,
	IGoogleLoginPayload,
	ILoginUserPayload,
	IRegisterUserPayload,
	IRequestUser,
	IResetPasswordPayload,
	IVerifyEmailPayload,
} from "./auth.interface";

const registerUser = async (payload: IRegisterUserPayload) => {
	const { name, password } = payload;
	const email = payload.email.trim().toLowerCase();

	const isUserExists = await prisma.user.findUnique({
		where: { email },
	});

	if (isUserExists) {
		throw new AppError(
			httpStatus.CONFLICT,
			"User with this email already exists",
		);
	}

	const hashedPassword = await bcrypt.hash(password, 8);
	const expirationSeconds = 5 * 60;

	const otpKey = `user-registration-otp:${email}`;
	const otpValue = crypto.randomInt(100000, 1000000).toString();

	await redisClient.set(otpKey, otpValue, { ex: expirationSeconds });

	const registrationKey = `user-registration-data:${email}`;
	const redisUserDataPayload = {
		name,
		email,
		password: hashedPassword,
	};

	await redisClient.set(
		registrationKey,
		JSON.stringify(redisUserDataPayload),
		{ ex: expirationSeconds },
	);

	const templatePath = path.join(
		process.cwd(),
		"src/app/templates/registration-user-otp.ejs",
	);

	const templateData = {
		name,
		email,
		otp: otpValue,
		expirationMinutes: expirationSeconds / 60,
	};

	const html = await ejs.renderFile(templatePath, templateData);

	await transporter.sendMail({
		from: config.email_sender,
		to: email,
		subject: "Email Verification - Courier & Logistics",
		html,
	});
};

const verifyUserEmail = async (payload: IVerifyEmailPayload) => {
	const otp = payload.otp;
	const email = payload.email.trim().toLowerCase();

	const isUserExist = await prisma.user.findUnique({
		where: { email },
	});

	if (isUserExist && !isUserExist.isActive) {
		throw new AppError(httpStatus.FORBIDDEN, "User is inactive or blocked");
	}

	if (isUserExist) {
		throw new AppError(httpStatus.CONFLICT, "User is already registered");
	}

	const otpKey = `user-registration-otp:${email}`;
	const redisOtp = await redisClient.get(otpKey);

	if (!redisOtp) {
		throw new AppError(httpStatus.BAD_REQUEST, "Invalid or expired OTP");
	}

	if (String(redisOtp) !== String(otp)) {
		throw new AppError(httpStatus.BAD_REQUEST, "OTP does not match");
	}

	await redisClient.del(otpKey);

	const registrationKey = `user-registration-data:${email}`;
	const redisUserData = await redisClient.get(registrationKey);

	if (!redisUserData) {
		throw new AppError(httpStatus.NOT_FOUND, "User registration data not found");
	}

	const userPayload = (
		typeof redisUserData === "string"
			? JSON.parse(redisUserData)
			: redisUserData
	) as IRegisterUserPayload;

	const createdUser = await prisma.user.create({
		data: {
			name: userPayload.name,
			email: userPayload.email,
			passwordHash: userPayload.password,
			role: Role.CUSTOMER,
			isActive: true,
		},
		omit: { passwordHash: true },
	});

	await redisClient.del(registrationKey);

	const templatePath = path.join(
		process.cwd(),
		"src/app/templates/patient-welcome-email.ejs",
	);

	const templateData = {
		name: createdUser.name,
	};

	try {
		const html = await ejs.renderFile(templatePath, templateData);
		await transporter.sendMail({
			from: config.email_sender,
			to: createdUser.email,
			subject: "Welcome to Courier & Logistics",
			html,
		});
	} catch (error) {
		console.log("Welcome email error: ", error);
	}

	const jwtPayload = {
		userId: createdUser.id,
		name: createdUser.name,
		email: createdUser.email,
		role: createdUser.role,
	};

	const accessToken = jwtUtils.createToken(
		jwtPayload,
		config.jwt_access_secret,
		config.jwt_access_expires_in as SignOptions,
	);

	const refreshToken = jwtUtils.createToken(
		jwtPayload,
		config.jwt_refresh_secret,
		config.jwt_refresh_expires_in as SignOptions,
	);

	return {
		accessToken,
		refreshToken,
		user: createdUser,
	};
};

const loginUser = async (payload: ILoginUserPayload) => {
	const { password } = payload;
	const email = payload.email.trim().toLowerCase();

	const user = await prisma.user.findUnique({
		where: { email },
	});

	if (!user) {
		throw new AppError(httpStatus.NOT_FOUND, "User not found");
	}

	if (!user.isActive) {
		throw new AppError(httpStatus.FORBIDDEN, "User account is inactive or blocked");
	}

	const isPasswordMatched = await bcrypt.compare(password, user.passwordHash);

	if (!isPasswordMatched) {
		throw new AppError(httpStatus.UNAUTHORIZED, "Invalid credentials");
	}

	const jwtPayload = {
		userId: user.id,
		name: user.name,
		email: user.email,
		role: user.role,
	};

	const accessToken = jwtUtils.createToken(
		jwtPayload,
		config.jwt_access_secret,
		config.jwt_access_expires_in as SignOptions,
	);

	const refreshToken = jwtUtils.createToken(
		jwtPayload,
		config.jwt_refresh_secret,
		config.jwt_refresh_expires_in as SignOptions,
	);

	return {
		accessToken,
		refreshToken,
	};
};

const getMe = async (user: IRequestUser) => {
	const isUserExists = await prisma.user.findUnique({
		where: {
			id: user.userId,
		},
		omit: {
			passwordHash: true,
		},
	});

	if (!isUserExists) {
		throw new AppError(httpStatus.NOT_FOUND, "User not found");
	}

	return isUserExists;
};

const refreshToken = async (token: string) => {
	const verifiedRefreshToken = jwtUtils.verifyToken(
		token,
		config.jwt_refresh_secret,
	);

	if (!verifiedRefreshToken.success || !verifiedRefreshToken.data) {
		throw new AppError(
			httpStatus.UNAUTHORIZED,
			config.node_env === "development"
				? verifiedRefreshToken.error
				: "Invalid refresh token",
		);
	}

	const data = verifiedRefreshToken.data as JwtPayload;

	const user = await prisma.user.findUnique({
		where: { id: data.userId },
	});

	if (!user || !user.isActive) {
		throw new AppError(
			httpStatus.UNAUTHORIZED,
			"User is inactive or not found",
		);
	}

	const jwtPayload = {
		userId: user.id,
		name: user.name,
		email: user.email,
		role: user.role,
	};

	const accessToken = jwtUtils.createToken(
		jwtPayload,
		config.jwt_access_secret,
		config.jwt_access_expires_in as SignOptions,
	);

	const newRefreshToken = jwtUtils.createToken(
		jwtPayload,
		config.jwt_refresh_secret,
		config.jwt_refresh_expires_in as SignOptions,
	);

	return {
		accessToken,
		refreshToken: newRefreshToken,
	};
};

const googleLogin = async (payload: IGoogleLoginPayload) => {
	let googleIdTokenPayload: TokenPayload | null | undefined = null;
	try {
		const ticket = await googleClient.verifyIdToken({
			idToken: payload.idToken,
			audience: config.google_client_id,
		});

		googleIdTokenPayload = ticket.getPayload();
	} catch (error) {
		console.log("Google ID Token Verification Failed", error);
		throw new AppError(
			httpStatus.UNAUTHORIZED,
			"Invalid Or Expired Google Id Token",
		);
	}

	if (!googleIdTokenPayload || !googleIdTokenPayload.email || !googleIdTokenPayload.name) {
		throw new AppError(httpStatus.BAD_REQUEST, "Google user details not found");
	}

	let user = await prisma.user.findUnique({
		where: {
			email: googleIdTokenPayload.email,
		},
	});

	if (user) {
		if (!user.isActive) {
			throw new AppError(httpStatus.FORBIDDEN, "User is inactive or blocked");
		}
	} else {
		const randomPassword = crypto.randomBytes(16).toString("hex");
		const hashedPassword = await bcrypt.hash(randomPassword, 8);

		user = await prisma.user.create({
			data: {
				name: googleIdTokenPayload.name,
				email: googleIdTokenPayload.email,
				passwordHash: hashedPassword,
				role: Role.CUSTOMER,
				isActive: true,
			},
		});
	}

	const jwtPayload = {
		userId: user.id,
		name: user.name,
		email: user.email,
		role: user.role,
	};

	const accessToken = jwtUtils.createToken(
		jwtPayload,
		config.jwt_access_secret,
		config.jwt_access_expires_in as SignOptions,
	);

	const refreshTokenValue = jwtUtils.createToken(
		jwtPayload,
		config.jwt_refresh_secret,
		config.jwt_refresh_expires_in as SignOptions,
	);

	return {
		accessToken,
		refreshToken: refreshTokenValue,
	};
};

const forgotPassword = async (payload: IForgotPasswordPayload) => {
	const { email } = payload;

	const isUserExist = await prisma.user.findUnique({
		where: {
			email,
		},
	});

	if (!isUserExist) {
		throw new AppError(httpStatus.NOT_FOUND, "User Does Not Exist!");
	}

	if (!isUserExist.isActive) {
		throw new AppError(httpStatus.FORBIDDEN, "User is inactive or blocked");
	}

	const otp = crypto.randomInt(100000, 1000000).toString();
	const key = `forgot-password-otp:${isUserExist.email}`;
	const expirationSeconds = 5 * 60;

	await redisClient.set(key, otp, { ex: expirationSeconds });

	const templatePath = path.join(
		process.cwd(),
		"src/app/templates/forgot-password.ejs",
	);

	const templateData = {
		name: isUserExist.name,
		otp,
		expirationMinutes: expirationSeconds / 60,
	};

	const html = await ejs.renderFile(templatePath, templateData);

	await transporter.sendMail({
		from: config.email_sender,
		to: isUserExist.email,
		subject: "Forgot Password - OTP",
		html,
	});
};

const resetPassword = async (payload: IResetPasswordPayload) => {
	const { email, otp, newPassword } = payload;

	const isUserExist = await prisma.user.findUnique({
		where: {
			email,
		},
	});

	if (!isUserExist) {
		throw new AppError(httpStatus.NOT_FOUND, "User Does Not Exist!");
	}

	if (!isUserExist.isActive) {
		throw new AppError(httpStatus.FORBIDDEN, "User is inactive or blocked");
	}

	const key = `forgot-password-otp:${isUserExist.email}`;
	const redisOtp = await redisClient.get(key);

	if (!redisOtp) {
		throw new AppError(httpStatus.BAD_REQUEST, "Invalid or expired OTP");
	}

	if (String(redisOtp) !== String(otp)) {
		throw new AppError(httpStatus.BAD_REQUEST, "OTP Does Not Match");
	}

	const hashedNewPassword = await bcrypt.hash(
		newPassword,
		Number(config.bcrypt_salt_rounds) || 8,
	);

	await prisma.user.update({
		where: {
			email: isUserExist.email,
		},
		data: {
			passwordHash: hashedNewPassword,
		},
	});

	await redisClient.del(key);

	const templatePath = path.join(
		process.cwd(),
		"src/app/templates/reset-password-success.ejs",
	);

	const templateData = {
		name: isUserExist.name,
	};

	try {
		const html = await ejs.renderFile(templatePath, templateData);
		await transporter.sendMail({
			from: config.email_sender,
			to: isUserExist.email,
			subject: "Password Changed Successfully",
			html,
		});
	} catch (error) {
		console.log("Reset password confirmation email error: ", error);
	}
};

export const AuthService = {
	registerUser,
	verifyUserEmail,
	loginUser,
	getMe,
	refreshToken,
	googleLogin,
	forgotPassword,
	resetPassword,
};
