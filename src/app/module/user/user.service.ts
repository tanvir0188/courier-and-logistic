import type { UploadApiResponse } from "cloudinary";
import httpStatus from "http-status";
import { cloudinary } from "../../lib/cloudinary";
import { prisma } from "../../lib/prisma";
import { AppError } from "../../utils/AppError";

export interface IUpdateProfilePayload {
	name?: string;
	phone?: string;
	profilePic?: string;
}

const updateProfile = async (
	userId: string,
	payload?: IUpdateProfilePayload,
	fileBuffer?: Buffer,
) => {
	const currentUser = await prisma.user.findUnique({
		where: {
			id: userId,
		},
	});

	if (!currentUser) {
		throw new AppError(httpStatus.NOT_FOUND, "User not found");
	}

	let uploadedProfilePicUrl: string | undefined;

	if (fileBuffer) {
		const cloudinaryResult = await new Promise<UploadApiResponse>(
			(resolve, reject) => {
				cloudinary.uploader
					.upload_stream(
						{
							resource_type: "image",
							folder: `courier_service/${currentUser.role}`,
						},
						(error, result) => {
							if (error) {
								return reject(error);
							}
							if (!result) {
								return reject(new Error("No result returned from Cloudinary"));
							}
							resolve(result);
						},
					)
					.end(fileBuffer);
			},
		);

		uploadedProfilePicUrl = cloudinaryResult.secure_url;

		if (currentUser.profilePic) {
			try {
				const parts = currentUser.profilePic.split("/");
				const fileName = parts.pop()?.split(".")[0];
				const uploadIdx = parts.indexOf("upload");
				let publicId = fileName;
				if (uploadIdx !== -1 && parts.length > uploadIdx + 1) {
					const subParts = parts
						.slice(uploadIdx + 1)
						.filter((p) => !/^v\d+$/.test(p));
					publicId =
						subParts.length > 0
							? `${subParts.join("/")}/${fileName}`
							: fileName;
				}
				if (publicId) {
					await cloudinary.uploader.destroy(publicId);
				}
			} catch (error) {
				console.log("Error deleting old profile pic:", error);
			}
		}
	}

	const updateData: {
		name?: string;
		phone?: string;
		profilePic?: string;
	} = {};

	if (payload?.name && payload.name.trim() !== "") {
		updateData.name = payload.name.trim();
	}

	if (payload?.phone !== undefined) {
		updateData.phone = payload.phone.trim();
	}

	if (uploadedProfilePicUrl) {
		updateData.profilePic = uploadedProfilePicUrl;
	} else if (payload?.profilePic && payload.profilePic.trim() !== "") {
		updateData.profilePic = payload.profilePic.trim();
	}

	const updatedUser = await prisma.user.update({
		where: {
			id: userId,
		},
		data: updateData,
		omit: {
			passwordHash: true,
		},
	});

	return updatedUser;
};

export const UserServices = {
	updateProfile
};
