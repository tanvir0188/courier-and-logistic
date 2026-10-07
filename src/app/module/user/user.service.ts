import type { UploadApiResponse } from "cloudinary";
import { cloudinary } from "../../lib/cloudinary";
import { prisma } from "../../lib/prisma";

const uploadProfileImage = async (buffer: Buffer, userId: string) => {
	const currentUser = await prisma.user.findUnique({
		where: {
			id: userId,
		},
	});

	if (!currentUser) {
		throw new Error("User not found");
	}

	const cloudinaryResult = await new Promise<UploadApiResponse>(
		(resolve, reject) => {
			cloudinary.uploader
				.upload_stream(
					{
						resource_type: "auto",
					},

					async (error, result) => {
						if (error) {
							return reject(error);
						}

						if (!result) {
							return reject(new Error("No result returned from Cloudinary"));
						}

						resolve(result);
					},
				)
				.end(buffer);
		},
	);

	const updatedUser = await prisma.user.update({
		where: {
			id: userId,
		},

		data: {
			profilePic: cloudinaryResult.secure_url,
		},

		omit: {
			passwordHash: true,
		},
	});

	if (currentUser?.profilePic) {
		await cloudinary.uploader.destroy(currentUser.profilePic);
	}

	return updatedUser;
};

export const UserServices = {
	uploadProfileImage,
};
