/*
  Warnings:

  - You are about to drop the column `courier_id` on the `shipments` table. All the data in the column will be lost.
  - Added the required column `receiver_zone_id` to the `shipments` table without a default value. This is not possible if the table is not empty.
  - Added the required column `sender_zone_id` to the `shipments` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "shipments" DROP CONSTRAINT "shipments_courier_id_fkey";

-- DropIndex
DROP INDEX "shipment_events_status_idx";

-- DropIndex
DROP INDEX "shipments_courier_id_idx";

-- DropIndex
DROP INDEX "shipments_created_at_idx";

-- DropIndex
DROP INDEX "shipments_provider_id_idx";

-- DropIndex
DROP INDEX "shipments_status_idx";

-- AlterTable
ALTER TABLE "shipments" DROP COLUMN "courier_id",
ADD COLUMN     "delivery_courier_id" TEXT,
ADD COLUMN     "pickup_courier_id" TEXT,
ADD COLUMN     "receiver_zone_id" TEXT NOT NULL,
ADD COLUMN     "sender_zone_id" TEXT NOT NULL;

-- CreateIndex
CREATE INDEX "shipments_provider_id_status_idx" ON "shipments"("provider_id", "status");

-- CreateIndex
CREATE INDEX "shipments_pickup_courier_id_idx" ON "shipments"("pickup_courier_id");

-- CreateIndex
CREATE INDEX "shipments_delivery_courier_id_idx" ON "shipments"("delivery_courier_id");

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_pickup_courier_id_fkey" FOREIGN KEY ("pickup_courier_id") REFERENCES "couriers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_delivery_courier_id_fkey" FOREIGN KEY ("delivery_courier_id") REFERENCES "couriers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_sender_zone_id_fkey" FOREIGN KEY ("sender_zone_id") REFERENCES "zones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_receiver_zone_id_fkey" FOREIGN KEY ("receiver_zone_id") REFERENCES "zones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
