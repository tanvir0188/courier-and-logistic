# 🚀 Phase 1 MVP Implementation Guide & Quotation

Based on your technical decisions, this guide provides a sequential roadmap for building the Phase 1 MVP of the Courier & Logistics Management Platform. 

**Your Stack & Architecture Decisions:**
- **Architecture:** Multi-tenant (Shared DB with `org_id` column) from Day 1
- **Tech Stack:** Express.js + TypeScript, PostgreSQL, Prisma ORM
- **Authentication:** Passport.js
- **Payment Gateway:** SSLCommerz
- **Notifications:** Email only
- **File Storage:** Cloudflare R2 (for Proof of Delivery, etc.)
- **Geo/Maps:** Open-source (e.g., OpenStreetMap / OSRM)
- **Courier Assignment:** Auto-suggest + Manual confirmation

---

## 🛠️ Sequential Implementation Plan

Since you are designing the DB and APIs yourself, here is the exact sequence of functional modules you should build to ensure a smooth, dependency-free development process.

### Phase 1: Foundation & Architecture (Week 1)
**Goal:** Set up the core multi-tenant architecture and authentication.

1. **Project Initialization**
   - Setup Express.js with TypeScript.
   - Initialize Prisma ORM and connect to PostgreSQL.
   - Setup global error handling and standard response formatter.
2. **Database Modeling (Prisma)**
   - Define the core models: `Organization`, `User`, `Hub`, `Zone`, `Shipment`, `TrackingEvent`.
   - Ensure all tenant-specific tables have an `org_id` field.
3. **Authentication & Authorization (Passport.js)**
   - Implement Super Admin login.
   - Implement Organization creation (Tenant onboarding).
   - Implement user registration/login (Customer, Admin, Courier, Hub Manager).
   - Create Role-Based Access Control (RBAC) middlewares to restrict route access.

### Phase 2: Platform Configuration (Week 2)
**Goal:** Allow Admins to configure the logistics network.

1. **Hub & Zone Management API**
   - CRUD operations for Hubs (Name, Location Lat/Lng, Org ID).
   - CRUD operations for Zones.
2. **Basic Pricing Engine API**
   - Create simple pricing rules per organization (e.g., base fee + per kg fee + distance multiplier).
   - Integrate OpenStreetMap/OSRM API for distance calculation between two points.

### Phase 3: Customer & Shipment Creation (Week 3)
**Goal:** Enable customers to create and pay for shipments.

1. **Shipment CRUD API**
   - Customer endpoint to create a DRAFT shipment.
   - API to estimate price based on the pricing engine.
2. **Payment Integration (SSLCommerz)**
   - Integrate SSLCommerz to initiate a payment session.
   - Create the webhook endpoint to receive successful payment callbacks.
   - Update shipment state to `PENDING` upon successful payment.
3. **Email Notifications Setup**
   - Setup a basic email service (e.g., Nodemailer with SMTP or Cloudflare Email).
   - Trigger a "Shipment Created" email to the customer.

### Phase 4: Operations & Courier Assignment (Week 4)
**Goal:** Route shipments to couriers using the hybrid assignment model.

1. **Ops Dashboard API**
   - Endpoint to list all `PENDING` shipments for the organization.
2. **Auto-Suggest Algorithm**
   - Logic to query available couriers near the pickup origin (using DB spatial queries or basic lat/lng bounding boxes).
3. **Manual Assignment API**
   - Endpoint for Ops Manager to manually assign a suggested Courier to a Shipment.
   - Update shipment state to `PICKUP_ASSIGNED`.
   - Send email notification to Courier (and Customer).

### Phase 5: Courier Workflow & R2 Storage (Week 5)
**Goal:** Enable couriers to execute pickups and deliveries.

1. **Courier Task API**
   - Endpoint for couriers to view their assigned active tasks.
2. **State Machine Updates API**
   - Endpoint for couriers to update shipment status (`PICKUP_IN_PROGRESS` → `PICKED_UP`).
   - Create a `TrackingEvent` record in the database for every state change.
3. **Cloudflare R2 Integration (Proof of Delivery)**
   - Setup R2 bucket and configure presigned URLs for secure uploads.
   - API to finalize delivery (`DELIVERED`) which accepts an image upload (Proof of Delivery) to R2.

### Phase 6: Hub Operations & Tracking (Week 6)
**Goal:** Connect the hubs and provide visibility.

1. **Hub Processing API**
   - Hub Manager endpoint to scan-in parcels (`AT_ORIGIN_HUB`).
   - Endpoint to dispatch transfers (`IN_TRANSIT`).
   - Endpoint to receive at destination (`AT_DESTINATION_HUB`).
2. **Public Tracking API**
   - Endpoint accessible without auth, taking a `tracking_number`.
   - Returns the shipment details and the array of `TrackingEvent`s chronologically.

---

## 💼 Project Quotation (Estimated Effort)

*Note: This estimation assumes a single full-stack developer (you) working on the backend APIs and DB design for the MVP.*

| Phase | Module | Est. Time | Complexity |
|-------|--------|-----------|------------|
| 1 | Foundation, Prisma, Passport Auth, Multi-tenant setup | 4-5 Days | Medium |
| 2 | Hubs, Zones, Pricing Engine, OpenStreetMap integration | 4-5 Days | Medium |
| 3 | Shipment Creation, SSLCommerz, Email Webhooks | 5-7 Days | High |
| 4 | Ops Dashboard, Courier Auto-suggest + Manual Assignment | 4-5 Days | High |
| 5 | Courier API, State Machine Tracking, Cloudflare R2 POD | 4-5 Days | Medium |
| 6 | Hub Operations, Public Tracking API | 3-4 Days | Low |
| 7 | Buffer (Testing, Bug fixing, Refactoring) | 5 Days | - |
| **Total** | **Phase 1 MVP Backend** | **~4 to 5 Weeks** | |

### Key Milestones for Invoicing / Delivery:
- **Milestone 1 (25%):** DB Schema finalized, Auth working, Multi-tenancy functional.
- **Milestone 2 (50%):** Customers can create shipments and pay via SSLCommerz successfully.
- **Milestone 3 (75%):** Shipments can be assigned to couriers and tracked through the hub network.
- **Milestone 4 (100%):** Proof of delivery (R2) working, email notifications firing, and end-to-end flow tested.

---
**Next Steps:**
You can now take this guide, start writing your Prisma `schema.prisma` file, and set up your Express routes module by module exactly as laid out above!
