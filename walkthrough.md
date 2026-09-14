# Walkthrough: Database Modeling & Schema Design

Initial multi-tenant database modeling and schema design have been completed according to [phase_1_implementation_guide.md](file:///home/arnob/private_projects/courier-and-logistic/phase_1_implementation_guide.md). No git commits or migrations were run, keeping all changes uncommitted as requested.

## Summary of Changes

### Modular Prisma Schema Architecture (`prisma/schema/`)

```
prisma/schema/
├── schema.prisma        (DataSource & Generator)
├── enums.prisma         (User, Auth, Logistics & Payment Enums)
├── user.prisma          (User, Organization, CourierProfile)
├── logistics.prisma     (Hub, Zone)
├── pricing.prisma       (PricingRule)
├── shipment.prisma      (Shipment, TrackingEvent)
└── payment.prisma       (Payment)
```

---

### Key Models & Relationships

#### 1. Multi-Tenant Organization & Users (`user.prisma`)
- [Organization](file:///home/arnob/private_projects/courier-and-logistic/prisma/schema/user.prisma#L36): Root tenant entity owning `Hubs`, `Zones`, `PricingRules`, `Shipments`, `TrackingEvents`, `Payments`, and `CourierProfiles`.
- [User](file:///home/arnob/private_projects/courier-and-logistic/prisma/schema/user.prisma#L1): Multi-role actor model (`SUPER_ADMIN`, `ADMIN`, `CUSTOMER`, `COURIER`, `HUB_MANAGER`, `OPS_MANAGER`). Linked to customer shipments, pickup/delivery courier assignments, managed hubs, and audit events.
- [CourierProfile](file:///home/arnob/private_projects/courier-and-logistic/prisma/schema/user.prisma#L57): Dedicated model for courier operations, vehicle types (`BIKE`, `MOTORCYCLE`, `VAN`, `TRUCK`), assigned hub, geo-coordinates (`currentLatitude`, `currentLongitude`), availability, and capacity for auto-suggest algorithms.

#### 2. Physical Network (`logistics.prisma`)
- [Hub](file:///home/arnob/private_projects/courier-and-logistic/prisma/schema/logistics.prisma#L1): Sorting and distribution centers with coordinates, manager assignment, and routing links (`originShipments`, `destinationShipments`, `currentShipments`).
- [Zone](file:///home/arnob/private_projects/courier-and-logistic/prisma/schema/logistics.prisma#L33): Coverage zones linked to hubs, postal codes, GeoJSON polygon coordinates, and rate multipliers.

#### 3. Dynamic Pricing Engine (`pricing.prisma`)
- [PricingRule](file:///home/arnob/private_projects/courier-and-logistic/prisma/schema/pricing.prisma#L1): Multi-tenant pricing rules configuring base fees, per-kg weight rates, distance multipliers, and zone-to-zone modifiers.

#### 4. Shipment Lifecycle & Tracking (`shipment.prisma`)
- [Shipment](file:///home/arnob/private_projects/courier-and-logistic/prisma/schema/shipment.prisma#L1): Core shipment record containing:
  - Unique public `trackingNumber`
  - Sender & pickup coordinates / address
  - Recipient & delivery coordinates / address
  - Package specs (weight, dimensions, package type, declared value)
  - Routing (`originHub`, `destinationHub`, `currentHub`)
  - Courier assignments (`pickupCourier`, `deliveryCourier`)
  - Status state machine (`DRAFT`, `PENDING`, `PICKUP_ASSIGNED`, `PICKUP_IN_PROGRESS`, `PICKED_UP`, `AT_ORIGIN_HUB`, `IN_TRANSIT`, `AT_DESTINATION_HUB`, `OUT_FOR_DELIVERY`, `DELIVERED`, `FAILED_DELIVERY`, `RETURNED_TO_SENDER`, `CANCELLED`)
  - Financials & Payment status
  - Proof of Delivery (Cloudinary image URL, public ID, signature, recipient name, notes, deliveredAt)
- [TrackingEvent](file:///home/arnob/private_projects/courier-and-logistic/prisma/schema/shipment.prisma#L89): Chronological audit trail of parcel movements and status transitions for public tracking.

#### 5. Payments (`payment.prisma`)
- [Payment](file:///home/arnob/private_projects/courier-and-logistic/prisma/schema/payment.prisma#L1): Tracks payment transactions with Stripe session and PaymentIntent IDs, amounts, and statuses.

---

## Validation Results

- Ran `npx prisma validate`: **Passed successfully** (`The schemas at prisma/schema are valid 🚀`).
- Ran `npx prisma format`: **Formatted cleanly** across all schema files.
- `git status`: All schema changes remain uncommitted and unstaged in working directory as requested.
