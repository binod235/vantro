# Vantro — Project Memory File
# Claude Code reads this automatically every session.
# Never delete or move this file.

## WHAT VANTRO IS
Vantro is a UK-native SaaS platform for small UK plumbing and heating firms
with 2 to 5 employees. It replaces the painful and expensive combination of
Tradify plus Xero that these firms currently pay £127 to £207 per month for.
Vantro charges £59 per month flat with no per-user fees.

## WHO THE CUSTOMERS ARE
Target customer: small UK plumbing and heating firm with 2 to 5 employees.
They are Gas Safe registered. They deal with CIS, MTD, and VAT Reverse Charge
daily. They are not technical. The software must be simple and fast.

Two user types per account:
- Owner or office manager — manages jobs, finances, compliance from desktop
- Field engineer — uses mobile interface on site for job details, Gas Safety
  Certificates, clock in and out, mileage

## TECH STACK — NEVER DEVIATE FROM THIS
- Backend: Node.js, TypeScript, NestJS
- Database: PostgreSQL with Prisma ORM
- Frontend: Next.js 14, TypeScript, Tailwind CSS
- Auth: Better Auth self-hosted — NEVER suggest Clerk (GDPR risk, US servers)
- Payments: Stripe + Stripe Connect (customer payments)
- Email: Resend — returns {data, error}, NEVER throws, always check error
- PDF generation: Puppeteer self-hosted
- File storage: Cloudflare R2 (job photos)
- Frontend hosting: Vercel (previously Cloudflare Pages)
- Backend hosting: Railway
- API testing: Thunder Client collections in /thunder-tests folder
- Version control: GitHub
- Monorepo: two workspaces — /api for NestJS, /web for Next.js

## PROJECT STRUCTURE
vantro/
├── api/                    # NestJS backend
│   ├── src/
│   │   ├── modules/
│   │   │   ├── auth/
│   │   │   ├── companies/
│   │   │   ├── users/
│   │   │   ├── customers/
│   │   │   ├── jobs/             # includes job-templates, job-stages, job-notifications
│   │   │   ├── quotes/
│   │   │   ├── invoices/
│   │   │   ├── gas-certificates/
│   │   │   ├── timesheets/
│   │   │   ├── staff/
│   │   │   ├── suppliers/
│   │   │   ├── price-lists/
│   │   │   ├── purchase-orders/
│   │   │   ├── recurring-jobs/
│   │   │   ├── reminders/
│   │   │   ├── payments/         # Stripe Connect customer payments
│   │   │   ├── comms/            # Communications history log
│   │   │   ├── job-service-reports/
│   │   │   ├── subcontractors/
│   │   │   ├── cis/              # TO BUILD THIS WEEK
│   │   │   ├── mtd/
│   │   │   └── hmrc/
│   │   ├── prisma/
│   │   ├── common/
│   │   └── main.ts
├── web/                    # Next.js frontend
│   ├── app/
│   │   ├── dashboard/      # all owner + engineer pages
│   │   ├── invoice/[token] # public payment page
│   │   ├── quote/[token]   # public quote acceptance
│   │   └── service-report/[token] # public JSR sign-off
│   ├── components/
│   └── lib/
│       ├── api.ts          # all API calls — always add new endpoints here
│       └── types.ts        # all TypeScript types — always add new types here
├── thunder-tests/
├── CLAUDE.md               # This file — never delete
├── .env.example
└── README.md

## DATABASE RULES — LEGALLY CRITICAL
These rules are not optional. Getting them wrong causes HMRC penalties for users.

### CIS Deduction Rule — MOST IMPORTANT
deduction_amount = labour_amount * (deduction_rate / 100)
- ONLY apply deduction to labour_amount field
- NEVER apply deduction to materials_amount
- NEVER apply deduction to gross_amount or total
- NEVER apply deduction to VAT, equipment hire, or travelling expenses
- Deduction rates: GROSS status = 0%, STANDARD (verified) = 20%, HIGHER (unverified) = 30%
- Always store labour_amount and materials_amount as SEPARATE fields
- Always store deduction_amount separately for audit trail
- CIS tax month: 6th of month to 5th of NEXT month (NOT calendar month)
- CIS300 deadline: 19th of month following the tax month
- UTR (Unique Taxpayer Reference) is MANDATORY before any CIS payment recorded

### VAT Reverse Charge Rule
When is_reverse_charge is true on any invoice:
- Include this exact legal wording:
  "Reverse charge: customer to account for VAT to HMRC"
- Show the VAT amount that applies but mark it as reverse charge
- Never add VAT to the invoice total when reverse charge applies

### MTD Quarter Dates — UK Tax Year
- Q1: 6 April to 5 July
- Q2: 6 July to 5 October
- Q3: 6 October to 5 January
- Q4: 6 January to 5 April

## CODING PATTERNS — ALWAYS FOLLOW THESE

### Auth + Roles
- Use @CurrentUser() decorator to get current user
- Access company ID as user.companyId! (with non-null assertion)
- Owner-only endpoints: @Roles('OWNER') on class or method
- Public endpoints: @Public() decorator — bypasses BOTH SessionGuard AND RolesGuard
- Never use @Public() without checking it's genuinely needed

### Controller Routes
- All controllers use prefix: @Controller('api/module-name')
- Specific routes MUST come before :id routes to avoid NestJS collision
  e.g. GET /bulk-create and GET /templates BEFORE GET /:id
- Public token routes e.g. GET /public/:token BEFORE GET /:id

### Email (Resend)
- Resend returns {data, error} — it NEVER throws
- Always check: if (error) throw new Error(error.message)
- Fire-and-forget emails: void this.someService.sendEmail(...) — never await
- Communications logging: void this.commsService.log(...) after every email

### PDF Generation
- Copy pattern from api/src/modules/quotes/quote.pdf.ts
- Use Puppeteer with: headless:true, --no-sandbox, --disable-setuid-sandbox
- Always close browser in finally block

### Financial Amounts
- Store ALL money as integers in pence — NEVER floats
- £1.00 = 100, £59.99 = 5999, £1,234.56 = 123456
- Display: (pence / 100).toFixed(2) with £ symbol
- Receive from user: Math.round(parseFloat(input) * 100)

### Multi-tenancy
- EVERY database query must filter by company_id
- Never return data from one company to another
- Pattern: where: { id: itemId, company_id: companyId }

### Transactions
- Use prisma.$transaction() for operations touching multiple tables
- Always generate sequential numbers (invoice, quote, PO, JSR) inside transactions

### Frontend
- All API calls go in web/lib/api.ts
- All TypeScript interfaces go in web/lib/types.ts
- Owner-only UI: wrap in {isOwner && (...)}
- Engineer view: NEVER shows financial data, CIS, prices, or management features
- Mobile bottom nav: web/components/BottomNav.tsx (engineer-aware)
- New modules need adding to sidebar: web/components/Sidebar.tsx
- New owner-only routes need adding to middleware.ts OWNER_ONLY_ROUTES

## ROLES AND PERMISSIONS
- Owner: full access to everything in their company
- Engineer: read-only access to assigned jobs, can create timesheets
  and gas certificates for their assigned jobs only
- Never let an engineer see: financial data, CIS data, invoices, quotes,
  purchase orders, price lists, reports, other engineers' timesheets

## WHAT IS ALREADY BUILT — DO NOT REBUILD
These modules are complete and working:

### Core
- Auth (Better Auth, cookie sessions, NOT JWT)
- Company settings (full — branding, bank details, VAT, CIS number)
- Staff management + email invitations
- Customer management
- Supplier management

### Jobs
- Job CRUD + Kanban board (owner) + List view (engineer)
- Job edit modal (all fields editable post-creation)
- Job templates (save + reuse common job types)
- Recurring jobs (3 creation modes, custom frequency, calendar + on-completion triggers)
- Job stages / progress invoicing (percentage or fixed, create invoice per stage)
- Job photos (Cloudflare R2, Before/During/After phases)
- Job timer with GPS location (smart clock-in/out, schedule-aware)
- Job service reports (auto-fill from job data, customer sign-off portal)
- Job notifications (email engineer when assigned)

### Quoting + Invoicing
- Quotes (full CRUD, PDF 3 templates, email, approve step, online acceptance,
  decline with reason, revise accepted quotes, quote viewed tracking)
- Invoices (full CRUD, PDF 3 templates, email, VAT types including reverse charge,
  edit after creation, bulk invoicing / billing run)
- Quote-to-invoice conversion (pre-fills from accepted quote)
- Progress invoicing via job stages
- Quote & invoice reminders (auto-chase crons)
- Quote acceptance auto-creates job option

### Payments
- Stripe Connect (companies connect own Stripe account)
- Public payment page /invoice/[token]
- Pay Now (Stripe Checkout) + I've Already Paid (bank/cash/cheque)
- Payment review system (customer reports → owner confirms → marks paid)
- Payment reminder cron (configurable intervals, owner notification)

### Compliance
- Gas Safety Certificates (CP12, Boiler Service, Gas Warning, Installation)
- Digital signatures, Gas Safe number, engineer name, inspection date
- CP12 renewal reminders (cron, configurable days before expiry)

### Timesheets
- Full timesheet CRUD with smart timer + GPS
- Exceptions tab for admin review of flagged entries

### Price Lists + Kits
- Supplier price lists (manual entry + CSV import with column mapping)
- Item markup (cost price → sell price auto-calculated)
- Kit bundles (bundle items for one-click quoting)
- Search Price List + Add Kit buttons on quote and invoice forms

### Purchase Orders
- Full PO CRUD (create, send to supplier PDF email, mark received, cancel)
- Job costing tab (invoiced vs labour vs materials vs gross profit)
- Company-wide reports page (green/amber/red margin coding)

### Reminders (all via @nestjs/schedule crons)
- Payment reminders (daily 08:00)
- CP12 renewal reminders (daily 08:00)
- Quote acceptance reminders (day 3 + day 7, daily 09:00)
- Appointment reminders (daily 09:00, configurable hours before)
- Manual trigger endpoints for testing all reminders

### Communications
- CommunicationLog model — every email auto-logged (fire and forget)
- Timeline on customer detail page + job detail page (owner only)

### Dashboard
- Owner: stats, revenue chart, today's jobs, recent invoices, pending reviews
- Engineer: active timer, today's jobs, this week's hours, quick actions

## WHAT TO BUILD NEXT — CIS RETURNS (CURRENT SPRINT)

### Build order — follow this exactly:

#### Day 1: Subcontractor profile upgrades
Subcontractor model already exists. Add:
- utr String (Unique Taxpayer Reference — MANDATORY for CIS)
- ni_number String? (sole traders)
- company_reg_number String? (limited companies)
- subcontractor_type: SOLE_TRADER | PARTNERSHIP | COMPANY
- cis_status: GROSS | STANDARD | HIGHER
- verification_number String? (from HMRC verification call)
- verification_date DateTime?
- deduction_rate Int (0 for GROSS, 20 for STANDARD, 30 for HIGHER)
Verification workflow UI — owner enters HMRC verification number and status

#### Day 2: Subcontractor bill model
New SubcontractorBill model:
- linked to subcontractor + job + company
- gross_amount_pence Int (total before deduction)
- labour_amount_pence Int (CIS deduction applies here ONLY)
- materials_amount_pence Int (NO deduction)
- vat_amount_pence Int (NO deduction)
- equipment_hire_pence Int (NO deduction)
- deduction_rate Int (snapshot of rate at time of bill)
- deduction_amount_pence Int (calculated: labour * rate / 100)
- net_payment_pence Int (gross - deduction)
- payment_date DateTime (actual payment date — used for CIS period grouping)
- tax_month String (e.g. "2026-05" representing 6 May to 5 June)

#### Day 3: CIS calculation engine
- Tax month grouping: 6th to 5th (NOT calendar month)
- calcTaxMonth(date: Date): string — returns the tax month string
- Per-subcontractor totals for each tax month
- Suffered deductions tracking (firm is also a sub — CIS deducted FROM them)
- Nil return detection (no payments in period)

#### Day 4: Payment & Deduction Statement PDF (PDS)
- One PDF per subcontractor per tax month (legal requirement)
- Must show: subcontractor name, UTR, tax month, gross paid, materials
  deducted, amount liable to deduction, deduction amount, net payment
- Legal requirement: issued within 14 days of end of tax month
- Auto-send option

#### Day 5: CIS300 Monthly Return screen
- Lists all subcontractors paid in the tax month
- Shows total gross, total materials, total deductions per sub
- Nil return prompt if no payments recorded
- 19th deadline warning
- Matches HMRC CIS300 format exactly

#### Day 6: Exports + audit trail
- CSV export for accountant / Xero / QuickBooks
- Full audit log: every calculation logged with timestamp + user
- Annual reconciliation export (all months in tax year)
- CIS-exempt items clearly flagged in UI

#### Day 7: Testing + edge cases
- Verify 6th-5th date logic (especially month boundaries)
- Test all three deduction rates
- Test materials-only bill (zero deduction)
- Test nil return flow
- Test PDF statement accuracy

### After CIS — remaining roadmap:
1. SmartWrite (AI text improvement in quote/invoice/job description fields)
2. AI Assistant (conversational agent — create jobs, schedule, query data)
3. HMRC API digital submission (CIS300 + MTD VAT)
4. Vercel deploy + vantro.co.uk domain
5. Xero / QuickBooks sync
6. Capacitor iOS + Android app

## CODING RULES — ALWAYS FOLLOW
1. TypeScript strict mode — no any types (use unknown then narrow)
2. Validate inputs with class-validator DTOs
3. Handle errors with proper HTTP status codes
4. Write Thunder Client test when creating a new endpoint
5. Never hardcode credentials — use process.env.*
6. Always filter by company_id — multi-tenant, mandatory
7. Use Prisma transactions for multi-table operations
8. Money always in pence as integers
9. Dates stored UTC, displayed UK timezone
10. Prompt efficiency: read existing files before writing code,
    copy patterns from existing similar modules

## ENVIRONMENT VARIABLES
DATABASE_URL=postgresql://...
BETTER_AUTH_SECRET=...
STRIPE_SECRET_KEY=...
STRIPE_WEBHOOK_SECRET=...
STRIPE_PAYMENT_WEBHOOK_SECRET=...
STRIPE_PLATFORM_ACCOUNT_ID=...
RESEND_API_KEY=...
FROM_EMAIL=...
FRONTEND_URL=...
CLOUDFLARE_ACCOUNT_ID=...
R2_BUCKET_NAME=...
R2_ENDPOINT=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
HMRC_CLIENT_ID=...
HMRC_CLIENT_SECRET=...
HMRC_SANDBOX_URL=https://test-api.service.hmrc.gov.uk
HMRC_PRODUCTION_URL=https://api.service.hmrc.gov.uk
NEXT_PUBLIC_API_URL=...

## HMRC API NOTES
- Always use sandbox URL during development
- Never use production HMRC URL until explicitly told to
- HMRC API uses OAuth 2.0 — tokens expire, must be refreshed
- Always log HMRC API requests and responses for audit trail
- HMRC production approval takes 4-12 weeks after sandbox testing
- Monitor HMRC API changelog — APIs change, permanent maintenance obligation
- For CIS: use bridging approach (PDF/CSV) for V1 while awaiting API approval