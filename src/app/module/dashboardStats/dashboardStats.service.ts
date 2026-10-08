import {
	PaymentStatus,
	Role,
	ShipmentStatus,
} from "../../../generated/prisma/enums";
import { prisma } from "../../lib/prisma";
import type {
	IAdminDashboardStats,
	ICustomerDashboardStats,
	IProviderDashboardStats,
} from "./dashboardStats.interface";


const getProviderDashboardStats = async (
	providerId: string,
): Promise<IProviderDashboardStats> => {
	const [activeShipments, awaitingCourier, outForDelivery, revenueAgg] =
		await Promise.all([
			prisma.shipment.count({
				where: {
					providerId,
					status: {
						notIn: [
							ShipmentStatus.DELIVERED,
							ShipmentStatus.CANCELLED,
							ShipmentStatus.RETURNED,
						],
					},
				},
			}),
			prisma.shipment.count({
				where: {
					providerId,
					status: ShipmentStatus.PAYMENT_CONFIRMED,
				},
			}),
			prisma.shipment.count({
				where: {
					providerId,
					status: ShipmentStatus.OUT_FOR_DELIVERY,
				},
			}),
			prisma.shipment.aggregate({
				_sum: {
					totalAmount: true,
				},
				where: {
					providerId,
					status: {
						not: ShipmentStatus.CANCELLED,
					},
					payment: {
						status: PaymentStatus.SUCCESS,
					},
				},
			}),
		]);

	const totalRevenue = Number(
		Number(revenueAgg._sum.totalAmount || 0).toFixed(2),
	);

	return {
		activeShipments,
		awaitingCourier,
		outForDelivery,
		totalRevenue,
	};
};

const getCustomerDashboardStats = async (
	customerId: string,
): Promise<ICustomerDashboardStats> => {
	const [activeShipments, inTransit, delivered, spentAgg] = await Promise.all([
		prisma.shipment.count({
			where: {
				customerId,
				status: {
					notIn: [
						ShipmentStatus.DELIVERED,
						ShipmentStatus.CANCELLED,
						ShipmentStatus.RETURNED,
					],
				},
			},
		}),
		prisma.shipment.count({
			where: {
				customerId,
				status: ShipmentStatus.IN_TRANSIT,
			},
		}),
		prisma.shipment.count({
			where: {
				customerId,
				status: ShipmentStatus.DELIVERED,
			},
		}),
		prisma.payment.aggregate({
			_sum: {
				amount: true,
			},
			where: {
				customerId,
				status: PaymentStatus.SUCCESS,
			},
		}),
	]);

	const spent = Number(Number(spentAgg._sum.amount || 0).toFixed(2));

	return {
		activeShipments,
		inTransit,
		delivered,
		spent,
	};
};


const getAdminDashboardStats = async (): Promise<IAdminDashboardStats> => {
	const thirtyDaysAgo = new Date();
	thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

	const [totalUsers, providers, shipments, paymentAgg] = await Promise.all([
		prisma.user.count(),
		prisma.user.count({
			where: {
				role: Role.PROVIDER,
			},
		}),
		prisma.shipment.count({
			where: {
				createdAt: {
					gte: thirtyDaysAgo,
				},
			},
		}),
		prisma.payment.aggregate({
			_sum: {
				amount: true,
			},
			where: {
				status: PaymentStatus.SUCCESS,
			},
		}),
	]);

	const totalOnlinePayments = Number(
		Number(paymentAgg._sum.amount || 0).toFixed(2),
	);

	return {
		totalUsers,
		providers,
		shipments,
		shipmentsLast30Days: shipments,
		totalOnlinePayments,
	};
};

export const DashboardStatsService = {
	getProviderDashboardStats,
	getCustomerDashboardStats,
	getAdminDashboardStats,
};
