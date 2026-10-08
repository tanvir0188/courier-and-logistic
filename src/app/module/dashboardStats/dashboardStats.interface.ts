export interface IProviderDashboardStats {
	activeShipments: number;
	awaitingCourier: number;
	outForDelivery: number;
	totalRevenue: number;
}

export interface ICustomerDashboardStats {
	activeShipments: number;
	inTransit: number;
	delivered: number;
	spent: number;
}

export interface IAdminDashboardStats {
	totalUsers: number;
	providers: number;
	shipments: number;
	shipmentsLast30Days: number;
	totalOnlinePayments: number;
}
