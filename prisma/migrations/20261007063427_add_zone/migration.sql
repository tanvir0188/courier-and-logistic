/*
  Warnings:

  - Added the required column `zone_id` to the `couriers` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "couriers" ADD COLUMN     "zone_id" TEXT NOT NULL;

-- CreateTable
CREATE TABLE "zones" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "zones_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "zones_name_key" ON "zones"("name");

-- AddForeignKey
ALTER TABLE "couriers" ADD CONSTRAINT "couriers_zone_id_fkey" FOREIGN KEY ("zone_id") REFERENCES "zones"("id") ON DELETE CASCADE ON UPDATE CASCADE;
