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
- Payments: Stripe
- Email: Resend
- PDF generation: Puppeteer self-hosted
- Frontend hosting: Cloudflare Pages
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
│   │   │   ├── jobs/
│   │   │   ├── quotes/
│   │   │   ├── invoices/
│   │   │   ├── subcontractors/
│   │   │   ├── cis/
│   │   │   ├── mtd/
│   │   │   ├── gas-certificates/
│   │   │   ├── timesheets/
│   │   │   └── hmrc/
│   │   ├── prisma/
│   │   ├── common/
│   │   └── main.ts
├── web/                    # Next.js frontend
│   ├── app/
│   ├── components/
│   └── lib/
├── thunder-tests/          # Thunder Client API test collections
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
- Deduction rates: verified = 20%, unverified = 30%, gross status = 0%
- Always store labour_amount and materials_amount as separate fields
- Always store deduction_amount separately for audit trail

### VAT Reverse Charge Rule
When is_reverse_charge is true on any invoice:
- Include this exact legal wording on the invoice:
  "Reverse charge: customer to account for VAT to HMRC"
- Show the VAT amount that applies but mark it as reverse charge
- Supplier charges zero VAT — buyer accounts for it themselves
- Never add VAT to the invoice total when reverse charge applies

### MTD Quarter Dates — UK Tax Year
- Q1: 6 April to 5 July
- Q2: 6 July to 5 October
- Q3: 6 October to 5 January
- Q4: 6 January to 5 April

## DATABASE SCHEMA SUMMARY
Tables: Company, User, Customer, Job, Quote, Invoice, Subcontractor,
SubcontractorPayment, GasSafetyCertificate, Timesheet

Key relationships:
- Everything belongs to a Company (multi-tenant, always filter by company_id)
- Jobs belong to a Company and a Customer
- Quotes and Invoices belong to a Job
- SubcontractorPayments belong to a Job and a Subcontractor
- GasSafetyCertificates belong to a Job, Engineer, and Customer
- Timesheets belong to a User and a Job

CRITICAL: Every database query must filter by company_id.
Never return data from one company to another company's users.
This is a multi-tenant application. Data isolation is mandatory.

## ROLES AND PERMISSIONS
- Owner: full access to everything in their company
- Engineer: read only access to jobs assigned to them, can create timesheets
  and gas certificates for their assigned jobs only
- Never let an engineer see financial data, CIS data, or other engineers' data

## BUILD PHASES — CURRENT PHASE IS SHOWN BELOW
### Phase 1 — Job Management (CURRENT)
- Company, User, Customer, Job CRUD
- Session-based authentication with Better Auth (cookie sessions, NOT JWT)
- Role based access control
- Job kanban board frontend
- Job detail pages
- Customer management pages

### Phase 2 — NOT STARTED YET
- Quoting and invoicing
- CIS calculations and subcontractor payments
- VAT Reverse Charge invoices
- PDF generation for invoices

### Phase 3 — HMRC Submissions and Compliance (NOT STARTED)
- CIS300 monthly submission to HMRC
- MTD quarterly submission to HMRC
- Gas Safety Certificate generation
- HMRC sandbox integration

#### Phase 3 timeline and approval process
- HMRC production approval takes 4 to 12 weeks after sandbox testing is complete
- Start sandbox integration in parallel with Phase 2 — do not wait for Phase 2 to finish
- Submit HMRC production approval checklist as soon as sandbox testing is complete
- Use bridging API for first customers while awaiting production credentials
- Switch to direct API submission after production access is granted
- Do not block Phase 1 or Phase 2 on this

#### HMRC API ongoing maintenance — permanent obligation
- HMRC requires software providers to test all API endpoints they need access to
- For APIs in beta, HMRC targets a minimum 6-week deprecation notice before breaking changes
- APIs can and do change — monitor HMRC's API changelog continuously
- This is permanent ongoing maintenance, not a one-off task; factor into long-term planning

## CODING RULES — ALWAYS FOLLOW THESE
1. Always use TypeScript strict mode — no any types
2. Always validate inputs with class-validator DTOs
3. Always handle errors with proper HTTP status codes and messages
4. Always write the Thunder Client test request when creating a new endpoint
5. Never hardcode credentials — use environment variables from .env
6. Always filter database queries by company_id — this is multi-tenant
7. Always use Prisma transactions for operations that touch multiple tables
8. Financial amounts are always stored in pence as integers — never floats
   Example: £59.99 is stored as 5999 not 59.99
   This prevents floating point errors in financial calculations
9. Always add created_at and updated_at to every table
10. Dates are always stored in UTC, displayed in UK timezone to users

## FINANCIAL AMOUNTS — CRITICAL
Store ALL money values as integers in pence to avoid floating point errors.
£1.00 = 100 pence stored as integer 100
£59.99 = 5999 pence stored as integer 5999
£1,234.56 = 123456 pence stored as integer 123456
When displaying to user: divide by 100 and format with £ symbol
When receiving from user: multiply by 100 and store as integer

## ENVIRONMENT VARIABLES NEEDED
DATABASE_URL=postgresql://...
BETTER_AUTH_SECRET=...
STRIPE_SECRET_KEY=...
STRIPE_WEBHOOK_SECRET=...
RESEND_API_KEY=...
HMRC_CLIENT_ID=...
HMRC_CLIENT_SECRET=...
HMRC_SANDBOX_URL=https://test-api.service.hmrc.gov.uk
HMRC_PRODUCTION_URL=https://api.service.hmrc.gov.uk
NEXT_PUBLIC_API_URL=...

## HMRC API NOTES
- Always use sandbox URL during development
- Never use production HMRC URL until explicitly told to
- HMRC API uses OAuth 2.0 — tokens expire and must be refreshed
- Always log HMRC API requests and responses for audit trail
- CIS300 deadline: 19th of the month following the tax month
- MTD deadline: one month after the end of each quarter

## CURRENT STATUS
Phase 1 in progress. Building job management foundation first.
Ask me which specific feature to build next rather than building everything.
When I say build the next feature, check this file for what Phase 1 still needs.