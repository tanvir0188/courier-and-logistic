import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.join(process.cwd(), ".env") });

export default {
	node_env: process.env.NODE_ENV,
	port: process.env.PORT,
	database_url: process.env.DATABASE_URL,
	bak_url: process.env.BACKEND_URL,
	frontend_url: process.env.FRONTEND_URL,
	bcrypt_salt_rounds: process.env.BCRYPT_SALT_ROUNDS,
	jwt_access_secret: process.env.JWT_ACCESS_SECRET!,
	jwt_refresh_secret: process.env.JWT_REFRESH_SECRET!,
	jwt_access_expires_in: process.env.JWT_ACCESS_EXPIRES_IN!,
	jwt_refresh_expires_in: process.env.JWT_REFRESH_EXPIRES_IN!,
	google_client_id: process.env.GOOGLE_CLIENT_ID!,
	super_admin_name: process.env.SUPER_ADMIN_NAME!,
	super_admin_email: process.env.SUPER_ADMIN_EMAIL!,
	super_admin_password: process.env.SUPER_ADMIN_PASSWORD!,
	tester_admin_name: process.env.TESTER_ADMIN_NAME!,
	tester_admin_email: process.env.TESTER_ADMIN_EMAIL!,
	tester_admin_password: process.env.TESTER_ADMIN_PASSWORD!,
	tester_provider_name: process.env.TESTER_PROVIDER_NAME!,
	tester_provider_email: process.env.TESTER_PROVIDER_EMAIL!,
	tester_provider_password: process.env.TESTER_PROVIDER_PASSWORD!,
	// redis_user: process.env.REDIS_USER!,
	// redis_password: process.env.REDIS_PASSWORD!,
	// redis_host: process.env.REDIS_HOST!,
	// redis_port: process.env.REDIS_PORT!,
	redis_url: process.env.REDIS_URL!,
	redis_token: process.env.REDIS_TOKEN!,

	qstash_url: process.env.QSTASH_URL!,
	qstash_token: process.env.QSTASH_TOKEN!,
	qstash_current_signing_key: process.env.QSTASH_CURRENT_SIGNING_KEY!,
	qstash_next_signing_key: process.env.QSTASH_NEXT_SIGNING_KEY!,

	smtp_user: process.env.SMTP_USER!,
	smtp_password: process.env.SMTP_PASSWORD!,
	email_sender: process.env.EMAIL_SENDER!,
	cloudinary_cloud_name: process.env.CLOUDINARY_CLOUD_NAME!,
	cloudinary_api_key: process.env.CLOUDINARY_API_KEY!,
	cloudinary_api_secret: process.env.CLOUDINARY_API_SECRET!,
	stripe_public_key: process.env.STRIPE_PUBLIC_KEY!,
	stripe_secret_key: process.env.STRIPE_SECRET_KEY!,
	stripe_webhook_secret: process.env.STRIPE_WEBHOOK_SECRET!,
};
