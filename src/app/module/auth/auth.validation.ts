import z from "zod";

const UserRegistrationZodSchema = z.object({
	name: z
		.string({
			error: "Name must be a string",
		})
		.min(3, "Name must be at least 3 characters long!")
		.max(50, "Name must be at most 50 characters long!"),

	email: z.email("Invalid email!"),

	password: z
		.string()
		.min(8, "Password must be at least 8 characters long.")
		.regex(/[a-z]/, "Password must contain at least 1 lowercase letter.")
		.regex(/[A-Z]/, "Password must contain at least 1 uppercase letter.")
		.regex(/[0-9]/, "Password must contain at least 1 number.")
		.regex(
			/[^A-Za-z0-9]/,
			"Password must contain at least 1 special character.",
		),
});
const UserEmailVerifyZodSchema = z.object({
	email: z.email("Not email!!"),
	otp: z.string().length(6),
});

const LoginZodSchema = z.object({
	email: z.email(),
	password: z.string(),
});

const ForgotPasswordZodSchema = z.object({
	email: z.email(),
});

const ResetPasswordZodSchema = z.object({
	email: z.email(),
	newPassword: z
		.string()
		.min(8, "Password Must Minimum 8 Characters Long.")
		.regex(/[a-z]/, "Password must contain atleast 1 Lowercase Letter")
		.regex(/[A-Z]/, "Password must contain atleast 1 Uppercase Letter")

		.regex(/[0-9]/, "Password must contain atleast 1 Number")
		.regex(/[^A-Za-z0-9]/, "Password must contain atleast 1 Special Character"),
	otp: z.string().length(6),
});

export const UserValidation = {
	UserRegistrationZodSchema,
	UserEmailVerifyZodSchema,
	LoginZodSchema,
	ForgotPasswordZodSchema,
	ResetPasswordZodSchema,
};
