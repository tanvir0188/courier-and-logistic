import cron from "node-cron";
import { resumeInterruptedShipments } from "../module/shipment/shipment.simulator";

export const initCronJobs = () => {
	// Recurring watchdog: runs every 2 minutes to reconcile any stuck or interrupted shipment simulations
	cron.schedule("*/2 * * * *", async () => {
		try {
			await resumeInterruptedShipments();
		} catch (error) {
			console.error(
				"[Cron:Watchdog:Error] Failed to execute shipment watchdog:",
				error,
			);
		}
	});

	console.log("[Cron] Periodic background tasks initialized successfully.");
};
