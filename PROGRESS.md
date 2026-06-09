# Vantro — Build Progress

## Status: Phase 1 complete. Signup & monetisation flow complete (Steps A–G done). Quotes module complete. Step H (reminder emails) pending.

---

## Phase 1 — Job Management (COMPLETE)

### Step 1 — Monorepo scaffold + Prisma schema + Railway database
**Files created:**
- `api/prisma/schema.prisma` — full schema (Company, User, Customer, Job, Quote, Invoice, Subcontractor, SubcontractorPayment, GasSafetyCertificate, Timesheet)
- `api/package.json`, `web/package.json`, root `package.json` — npm workspaces monorepo
- `api/src/prisma/prisma.service.ts` — singleton Prisma client with `@Global()` module
- `.env.example`, `web/.env.local.example`

**Database:** PostgreSQL on Railway.
**Migration:** `20260526093137_init` — creates all tables.

---

### Step 2 — Better Auth session authentication
**Files created/modified:**
- `api/src/modules/auth/auth.config.ts` — Better Auth config with email/password, `additionalFields` (role, companyId), Resend for password reset emails, `trustedOrigins`
- `api/src/modules/auth/auth.module.ts` — global guards wired here
- `api/src/modules/auth/guards/session.guard.ts` — reads Better Auth session from cookie, attaches `request.user`
- `api/src/modules/auth/guards/roles.guard.ts` — enforces `@Roles('OWNER')` decorator
- `api/src/modules/auth/decorators/current-user.decorator.ts` — `@CurrentUser()` param decorator
- `api/src/modules/auth/decorators/public.decorator.ts` — `@Public()` skips auth guards
- `api/src/modules/auth/decorators/roles.decorator.ts` — `@Roles(...roles)` decorator
- `api/src/modules/auth/templates/reset-password.email.ts` — HTML email template
- `api/src/main.ts` — Better Auth mounted before NestJS routing; Express-level `cors()` applied first so `/api/auth/*` routes get CORS headers
- `web/app/sign-in/page.tsx` — sign-in form using `authClient.signIn.email()`
- `web/app/forgot-password/page.tsx` — uses `authClient.requestPasswordReset()`
- `web/app/reset-password/page.tsx` — uses `authClient.resetPassword()`
- `web/lib/auth-client.ts` — `createAuthClient({ baseURL })` pointing to API
- `web/middleware.ts` — protects all dashboard routes; public paths: `/sign-in`, `/sign-up`, `/forgot-password`, `/reset-password`

**Auth approach:** Cookie sessions (httpOnly, SameSite=Lax). NOT JWT. Never suggest Clerk.
**CORS fix:** `cors()` Express middleware applied before Better Auth mount so `/api/auth/*` also gets `Access-Control-Allow-Origin` headers. `app.enableCors()` removed in favour of this.

---

### Step 3 — Company and User CRUD
**Files created:**
- `api/src/modules/companies/companies.service.ts` — create (+ sets `trial_ends_at`), findForUser, update
- `api/src/modules/companies/companies.controller.ts` — `POST /companies`, `GET /companies/me`, `PATCH /companies/me`
- `api/src/modules/companies/dto/create-company.dto.ts` — name (2–100 chars)
- `api/src/modules/users/users.service.ts` — create (via Better Auth signUpEmail), findAll, findOne, findMe, update, remove
- `api/src/modules/users/users.controller.ts` — `POST /users`, `GET /users`, `GET /users/:id`, `GET /users/me`, `PATCH /users/:id`, `DELETE /users/:id`
- `api/src/modules/users/dto/create-user.dto.ts`, `update-user.dto.ts`
- `thunder-tests/company-user.json` — Thunder Client test collection

**Key rules:**
- One company per owner. Company creation sets `role = OWNER` atomically in a transaction.
- Removing a user clears `companyId` (soft remove) — preserves audit trail for gas certificates, timesheets.
- Owner can't remove themselves.

---

### Step 4 — Customer CRUD
**Files created:**
- `api/src/modules/customers/customers.service.ts` — create, findAll, findOne, update, remove (blocks delete if jobs exist → 409)
- `api/src/modules/customers/customers.controller.ts` — `POST`, `GET`, `GET /:id`, `PATCH /:id`, `DELETE /:id /customers`
- `api/src/modules/customers/dto/create-customer.dto.ts` — name (required), email, phone, address fields, postcode (UK regex validation)
- `api/src/modules/customers/dto/update-customer.dto.ts` — `PartialType(CreateCustomerDto)`
- `thunder-tests/customers.json`

**Permissions:** `POST`, `PATCH`, `DELETE` → OWNER only. `GET` → both roles.

---

### Step 5 — Job CRUD with status workflow
**Files created:**
- `api/src/modules/jobs/jobs.service.ts` — create, findAll (OWNER sees all; ENGINEER sees only assigned), findOne (404 for unassigned — doesn't reveal existence), updateStatus, update, remove
- `api/src/modules/jobs/jobs.controller.ts` — `POST`, `GET`, `GET /:id`, `PATCH /:id`, `DELETE /:id /jobs`
- `api/src/modules/jobs/dto/create-job.dto.ts`
- `api/src/modules/jobs/dto/update-job.dto.ts` — written from scratch (NOT PartialType) to support `engineer_id: null` and `scheduled_at: null` for explicit unset
- `thunder-tests/jobs.json`

**Status flow:** `QUOTED → SCHEDULED → IN_PROGRESS → COMPLETED → INVOICED`
**Engineer isolation:** `GET /jobs/:id` returns 404 (not 403) for unassigned jobs — prevents ID enumeration.
**FK error handling:** Prisma P2003 caught and re-thrown as 409 ConflictException.

---

### Step 6 — Kanban board frontend
**Files created:**
- `web/app/dashboard/layout.tsx` — sidebar + main content + TrialBanner + LockedOverlay
- `web/app/dashboard/jobs/page.tsx` — fetches jobs + currentUser; OWNER also fetches customers + engineers; optimistic status updates (revert via full reload on API failure)
- `web/components/Sidebar.tsx` — brand, nav links, user info, sign out
- `web/components/KanbanBoard.tsx` — renders 5 columns from `JOB_STATUSES`
- `web/components/KanbanColumn.tsx` — column header with count badge, job cards, chevron move buttons
- `web/components/CreateJobModal.tsx` — title, customer, engineer, status, scheduled date, description
- `web/lib/types.ts` — `JobStatus`, `JOB_STATUSES`, `STATUS_LABELS`, `STATUS_COLOURS`, `Job`, `Customer`, `Engineer`, `User`, `Company`, `SubscriptionStatus`
- `web/lib/api.ts` — `apiFetch` helper, `api.jobs`, `api.companies`, `api.customers`, `api.users`, `api.auth`

---

## Signup & Monetisation Flow (IN PROGRESS)

### Step A — Database schema: subscription fields ✅
**Migration:** `20260527121803_add_subscription_fields`
**Changes to `Company` model:**
```
subscription_status   SubscriptionStatus  @default(TRIAL)
trial_ends_at         DateTime
stripe_customer_id    String?
stripe_subscription_id String?
payment_failed        Boolean             @default(false)
```
**New enum:**
```
enum SubscriptionStatus { TRIAL  ACTIVE  LOCKED }
```

---

### Step B — Sign-up page + company creation ✅
**Files created/modified:**
- `api/src/modules/auth/dto/register.dto.ts` — name, email, password (min 8), company_name
- `api/src/modules/auth/register.controller.ts` — `POST /register` (`@Public()`): checks duplicate email, calls `auth.api.signUpEmail()`, creates company in transaction with `trial_ends_at = now + 14 days`, sets user as OWNER
- `web/app/sign-up/page.tsx` — "Start your free trial" form; on success calls register endpoint then `authClient.signIn.email()` for instant session, redirects to dashboard
- `web/.env.local` — `NEXT_PUBLIC_API_URL=http://localhost:3000`
- `thunder-tests/register.json`

**Trial period:** 14 days from sign-up, no credit card required.

---

### Step C — Subscription guard ✅
**File created:**
- `api/src/modules/auth/guards/subscription.guard.ts` — global guard (runs after session + roles); allows all GET/HEAD; blocks POST/PATCH/PUT/DELETE with `403 { message: '...', code: 'SUBSCRIPTION_LOCKED' }` when company is LOCKED; skips public routes and users with no companyId

---

### Step D — Trial lock cron job ✅
**Files created:**
- `api/src/modules/scheduler/trial.scheduler.ts` — `@Cron(EVERY_DAY_AT_MIDNIGHT)`: `updateMany` where `status = TRIAL AND trial_ends_at < now` → sets to LOCKED; logs count if any locked
- `api/src/modules/scheduler/scheduler.module.ts`
- `api/src/app.module.ts` updated — added `ScheduleModule.forRoot()` + `SchedulerModule`

**Note:** `@nestjs/schedule` hoists to monorepo root. `@nestjs/platform-express` must also be at root for it to resolve. Fixed by adding `@nestjs/platform-express` to root `devDependencies`.

---

### Step E — Trial banner ✅
**File created:**
- `web/components/TrialBanner.tsx` — fetches `GET /companies/me` on mount; shows nothing if ACTIVE/LOCKED; calculates days remaining; blue (>3 days) → amber (≤3) → red (≤1); "Subscribe now" links to `/subscribe`

---

### Step F — Lock screen overlay ✅
**Files created/modified:**
- `web/components/LockedOverlay.tsx` — listens for `window` event `vantro:subscription-locked`; shows fixed full-screen modal: "Your trial has ended", data safety reassurance, "Subscribe now — £59/month" button
- `web/lib/api.ts` — `apiFetch` now dispatches `vantro:subscription-locked` event when it receives `403` with `code: SUBSCRIPTION_LOCKED`

---

### Step G — Stripe checkout + webhook ✅ DONE
**Plan:**
- `POST /billing/checkout` — create Stripe Checkout session for £59/month subscription, set `stripe_customer_id`
- `POST /billing/webhook` — handle three events:
  - `checkout.session.completed` → set `subscription_status = ACTIVE`
  - `customer.subscription.deleted` → set `subscription_status = LOCKED`
  - `invoice.payment_failed` → set `payment_failed = true` (do NOT lock immediately — Stripe retries; lock only after `past_due` or `canceled`)
- `web/app/subscribe/page.tsx` — redirect to Stripe Checkout session URL

---

### Step H — Reminder emails ⏳ NOT STARTED
**Plan:**
- Extend `TrialScheduler` with a second `@Cron` job (runs daily)
- Send Resend email at day 10 and day 13 of trial
- Find companies where `subscription_status = TRIAL` and `trial_ends_at` is 4 days or 1 day away
- Use same Resend + HTML email pattern as `reset-password.email.ts`

---

## API Endpoints Reference

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/register` | Public | Create owner account + company (14-day trial) |
| POST | `/api/auth/sign-in/email` | Public | Better Auth — sign in |
| POST | `/api/auth/sign-out` | Public | Better Auth — sign out |
| POST | `/api/auth/forget-password` | Public | Better Auth — request reset link |
| POST | `/api/auth/reset-password` | Public | Better Auth — set new password |
| GET | `/api/companies/me` | Any | Get own company (includes subscription_status, trial_ends_at) |
| PATCH | `/api/companies/me` | OWNER | Update company name |
| GET | `/api/users/me` | Any | Get own user profile |
| GET | `/api/users` | OWNER | List all users in company |
| POST | `/api/users` | OWNER | Create engineer (invite) |
| PATCH | `/api/users/:id` | OWNER or self | Update user |
| DELETE | `/api/users/:id` | OWNER | Remove user from company |
| GET | `/api/customers` | Any | List customers |
| POST | `/api/customers` | OWNER | Create customer |
| GET | `/api/customers/:id` | Any | Get customer |
| PATCH | `/api/customers/:id` | OWNER | Update customer |
| DELETE | `/api/customers/:id` | OWNER | Delete customer (blocked if has jobs) |
| GET | `/api/jobs` | Any | List jobs (OWNER: all; ENGINEER: assigned only) |
| POST | `/api/jobs` | OWNER | Create job |
| GET | `/api/jobs/:id` | Any | Get job (ENGINEER: 404 if not assigned) |
| PATCH | `/api/jobs/:id` | Any | Update job |
| DELETE | `/api/jobs/:id` | OWNER | Delete job |

---

## Environment Variables

### `api/.env`
```
DATABASE_URL=postgresql://...@yamabiko.proxy.rlwy.net:56079/railway
BETTER_AUTH_SECRET=...
BETTER_AUTH_URL=http://localhost:3000
FRONTEND_URL=http://localhost:3001
RESEND_API_KEY=...
FROM_EMAIL=noreply@vantro.co.uk
STRIPE_SECRET_KEY=...          # needed for Step G
STRIPE_WEBHOOK_SECRET=...      # needed for Step G
```

### `web/.env.local`
```
NEXT_PUBLIC_API_URL=http://localhost:3000
```

---

## Key Architectural Decisions

| Decision | Choice | Reason |
|----------|--------|--------|
| Auth | Better Auth sessions (cookie) | GDPR — UK data stays on our servers. Never Clerk. |
| Passwords | Better Auth `signUpEmail` | Consistent hashing across self-signup and owner-created engineers |
| Multi-tenancy | `company_id` on every query | Hard isolation — no cross-company data leaks |
| Money | Integers in pence | No floating point errors. £59.99 = 5999 |
| Dates | UTC stored, UK timezone displayed | Avoids DST bugs |
| Engineer isolation | 404 (not 403) on unassigned jobs | Doesn't reveal that a job exists |
| CORS | Express-level `cors()` before Better Auth | NestJS `app.enableCors()` never runs for `/api/auth/*` routes |
| Nullable DTOs | Written from scratch (not PartialType) | `PartialType` can't widen to `null` for explicit unset |
| Trial lock | Daily cron + `updateMany` | Single DB call locks all expired trials atomically |
| Lock screen | Custom browser event | Any component can trigger it without prop drilling |
