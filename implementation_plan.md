# Implementation Plan: Initial Database Modeling (Prisma Schema)

Design and structure the multi-tenant database schema for the Courier & Logistics Management Platform, following the requirements and phases defined in [phase_1_implementation_guide.md](file:///home/arnob/private_projects/courier-and-logistic/phase_1_implementation_guide.md).

## User Review Required

> [!IMPORTANT]
> - **Multi-tenant Isolation**: Every tenant-scoped entity (`User`, `Hub`, `Zone`, `PricingRule`, `Shipment`, `TrackingEvent`, `Payment`, `CourierProfile`) explicitly includes `orgId` and compound indexes (e.g. `@@index([orgId, status])`) for strict data isolation and performant querying.
> - **Modular Prisma Schema**: Leveraging Prisma 7's multi-file schema directory (`prisma/schema/`), dividing models cleanly across `enums.prisma`, `user.prisma`, `logistics.prisma`, `pricing.prisma`, `shipment.prisma`, and `payment.prisma`.
> - **No Database Migrations or Git Commits in this step**: As requested, we are only designing and writing the Prisma schema definitions and validating them with `prisma validate`. Database migrations (`prisma migrate dev` / `prisma db push`) and git commits will not be executed until explicitly requested.



## Proposed Schema Breakdown

### 1. `prisma/schema/enums.prisma`
Expands existing enums with state machine and logistics domains:
- **`Role`** (existing): `SUPER_ADMIN`, `ADMIN`, `CUSTOMER`, `COURIER`, `HUB_MANAGER`, `OPS_MANAGER`
- **`UserStatus`** (existing): `ACTIVE`, `BLOCKED`, `DELETED`
- **`AuthProvider`** (existing): `GOOGLE`, `CREDENTIAL`
- **`ShipmentStatus`** (new):
  - `DRAFT` — Customer created initial draft
  - `PENDING` — Payment verified, awaiting courier assignment
  - `PICKUP_ASSIGNED` — Courier assigned for pickup
  - `PICKUP_IN_PROGRESS` — Courier en route to sender
  - `PICKED_UP` — Parcel collected from sender
  - `AT_ORIGIN_HUB` — Checked in at sender-side hub
  - `IN_TRANSIT` — Moving between hubs/transfers
  - `AT_DESTINATION_HUB` — Checked in at delivery-side hub
  - `OUT_FOR_DELIVERY` — Courier out on last-mile delivery
  - `DELIVERED` — Successfully delivered with POD
  - `FAILED_DELIVERY` — Delivery attempt failed
  - `RETURNED_TO_SENDER` — Returned to origin
  - `CANCELLED` — Order cancelled before pickup
- **`PackageType`** (new): `DOCUMENT`, `PARCEL`, `FRAGILE`, `OVERSIZED`
- **`PaymentStatus`** (new): `PENDING`, `PAID`, `FAILED`, `REFUNDED`
- **`PaymentMethod`** (new): `STRIPE`, `CASH_ON_DELIVERY`
- **`VehicleType`** (new): `BIKE`, `MOTORCYCLE`, `VAN`, `TRUCK`

---

### 2. `prisma/schema/user.prisma`
Updates `Organization` and `User` with multi-tenant relational hooks, and adds `CourierProfile`:
- **`Organization`**:
  - Adds relations to `Hub[]`, `Zone[]`, `Shipment[]`, `TrackingEvent[]`, `Payment[]`, `PricingRule[]`, `CourierProfile[]`.
  - Fields: `id`, `name`, `subdomain`, `email`, `phone`, `address`, `currency` (default `"USD"`), `isActive` (default `true`), timestamps.
- **`User`**:
  - Connects to `CourierProfile?`, `shipmentsAsCustomer Shipment[]`, `shipmentsAsPickupCourier Shipment[]`, `shipmentsAsDeliveryCourier Shipment[]`, `managedHubs Hub[]`, `trackingEvents TrackingEvent[]`, `payments Payment[]`.
  - Retains existing fields (`id`, `name`, `email`, `password`, `googleId`, `authProvider`, `emailVerified`, `role`, `status`, `needPasswordChange`, `imageUrl`, `imagePublicId`, `isDeleted`, `deletedAt`, `orgId`).
- **`CourierProfile`**:
  - Dedicated model for courier operations and auto-suggest matching (Phase 4):
  - Fields: `id`, `userId` (unique), `orgId`, `vehicleType`, `licensePlate`, `assignedHubId`, `currentLatitude`, `currentLongitude`, `isAvailable` (boolean), `maxCapacityKg`, `rating`, timestamps.

---

### 3. `prisma/schema/logistics.prisma` (NEW)
Defines physical logistics infrastructure:
- **`Hub`**:
  - Fields: `id`, `orgId`, `name`, `code`, `address`, `city`, `postalCode`, `latitude`, `longitude`, `phone`, `email`, `managerId` (User), `isActive`, timestamps.
  - Relations: `organization`, `manager`, `zones`, `originShipments`, `destinationShipments`, `currentShipments`, `trackingEvents`, `stationedCouriers`.
  - Indexes: `@@unique([orgId, code])`, `@@index([orgId])`, `@@index([latitude, longitude])`.
- **`Zone`**:
  - Fields: `id`, `orgId`, `hubId` (optional link to parent hub), `name`, `code`, `description`, `city`, `postalCodes` (string array or comma-separated), `polygonCoordinates` (Json GeoJSON / coordinate bounds), `rateMultiplier` (Float @default(1.0)), `isActive`, timestamps.
  - Relations: `organization`, `hub`, `pickupShipments`, `deliveryShipments`, `pricingRulesFrom`, `pricingRulesTo`.
  - Indexes: `@@unique([orgId, code])`, `@@index([orgId, hubId])`.

---

### 4. `prisma/schema/pricing.prisma` (NEW)
Supports Phase 2 Basic Pricing Engine:
- **`PricingRule`**:
  - Fields: `id`, `orgId`, `name`, `baseFee` (Decimal), `perKgFee` (Decimal), `distanceMultiplier` (Decimal rate/km), `minWeightKg` (Float @default(0)), `maxWeightKg` (Float?), `zoneFromId` (Zone?), `zoneToId` (Zone?), `isActive`, timestamps.
  - Relations: `organization`, `zoneFrom`, `zoneTo`.
  - Indexes: `@@index([orgId])`, `@@index([orgId, zoneFromId, zoneToId])`.

---

### 5. `prisma/schema/shipment.prisma` (NEW)
Core parcel tracking and lifecycle model:
- **`Shipment`**:
  - **Identifiers**: `id` (uuid), `trackingNumber` (unique string, e.g. `TRK-XXXXXXXXX`), `orgId`.
  - **Actors**: `senderId` (customer), `pickupCourierId` (courier), `deliveryCourierId` (courier).
  - **Pickup Details**: `senderName`, `senderPhone`, `senderEmail`, `pickupAddress`, `pickupCity`, `pickupPostalCode`, `pickupLatitude`, `pickupLongitude`, `pickupZoneId`, `pickupDate`.
  - **Delivery Details**: `recipientName`, `recipientPhone`, `recipientEmail`, `deliveryAddress`, `deliveryCity`, `deliveryPostalCode`, `deliveryLatitude`, `deliveryLongitude`, `deliveryZoneId`.
  - **Hub Routing**: `originHubId`, `destinationHubId`, `currentHubId`.
  - **Parcel Specs**: `packageType`, `description`, `weightKg`, `lengthCm`, `widthCm`, `heightCm`, `declaredValue`.
  - **Pricing & Payment**: `distanceKm`, `deliveryFee`, `discountAmount`, `totalAmount`, `paymentStatus`, `paymentMethod`.
  - **State**: `status` (ShipmentStatus @default(DRAFT)).
  - **Proof of Delivery (POD - Phase 5 Cloudinary integration)**: `podImageUrl`, `podPublicId`, `podSignatureUrl`, `podRecipientName`, `podNotes`, `podDeliveredAt`.
  - **Timestamps**: `estimatedDeliveryDate`, `actualDeliveryDate`, `createdAt`, `updatedAt`.
  - **Indexes**:
    - `@@unique([trackingNumber])`
    - `@@index([orgId, status])`
    - `@@index([orgId, senderId])`
    - `@@index([orgId, pickupCourierId])`
    - `@@index([orgId, deliveryCourierId])`
    - `@@index([orgId, currentHubId])`
    - `@@index([createdAt])`
- **`TrackingEvent`**:
  - Audit trail and public tracking history (Phase 5 & 6):
  - Fields: `id`, `orgId`, `shipmentId`, `status` (ShipmentStatus), `title`, `description`, `location`, `latitude`, `longitude`, `hubId` (Hub?), `actorId` (User?), `timestamp` (@default(now())).
  - Indexes:
    - `@@index([shipmentId, timestamp])`
    - `@@index([orgId, shipmentId])`

---

### 6. `prisma/schema/payment.prisma` (NEW)
Supports Stripe payment integration (Phase 3):
- **`Payment`**:
  - Fields: `id`, `orgId`, `shipmentId`, `userId`, `amount` (Decimal), `currency` (String @default("USD")), `status` (PaymentStatus @default(PENDING)), `provider` (String @default("STRIPE")), `stripeSessionId` (unique?), `stripePaymentIntentId` (unique?), `transactionId` (string?), `metadata` (Json?), timestamps.
  - Indexes: `@@index([orgId, shipmentId])`, `@@index([orgId, userId])`.

---

## Proposed Changes

### Database Modeling

#### [MODIFY] [prisma/schema/enums.prisma](file:///home/arnob/private_projects/courier-and-logistic/prisma/schema/enums.prisma)
- Add enums: `ShipmentStatus`, `PackageType`, `PaymentStatus`, `PaymentMethod`, `VehicleType`.

#### [MODIFY] [prisma/schema/user.prisma](file:///home/arnob/private_projects/courier-and-logistic/prisma/schema/user.prisma)
- Update `User` and `Organization` with relational fields.
- Add `CourierProfile` model with location, capacity, and status fields.

#### [NEW] [prisma/schema/logistics.prisma](file:///home/arnob/private_projects/courier-and-logistic/prisma/schema/logistics.prisma)
- Define `Hub` and `Zone` models with spatial coordinates and tenant keys.

#### [NEW] [prisma/schema/pricing.prisma](file:///home/arnob/private_projects/courier-and-logistic/prisma/schema/pricing.prisma)
- Define `PricingRule` model with weight, distance, and zone parameters.

#### [NEW] [prisma/schema/shipment.prisma](file:///home/arnob/private_projects/courier-and-logistic/prisma/schema/shipment.prisma)
- Define `Shipment` model with lifecycle statuses, routing, recipient/sender details, and POD.
- Define `TrackingEvent` model for timeline tracking.

#### [NEW] [prisma/schema/payment.prisma](file:///home/arnob/private_projects/courier-and-logistic/prisma/schema/payment.prisma)
- Define `Payment` model for Stripe checkouts and transaction logging.

---

## Verification Plan

### Automated Schema Validation
- Run `npx prisma validate` to ensure all models, relations, field attributes, and syntax conform to Prisma 7 multi-file schema specifications without errors or circular relation conflicts.
- Run `npx prisma format` to ensure uniform indentation and formatting across all `.prisma` files in `prisma/schema/`.

### Manual Review
- Verify that every tenant model includes `orgId` and indexes.
- Verify that `phase_1_implementation_guide.md` phases (1 through 6) are completely covered by the schema.
