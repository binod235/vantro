import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Resend } from 'resend';
import AdmZip from 'adm-zip';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { CisEngineService } from '../subcontractors/cis-engine.service';

// ── Month helpers ─────────────────────────────────────────────────────────────

function parseMonth(month: string): { start: Date; end: Date; label: string } {
  const [y, m] = month.split('-').map(Number);
  const start = new Date(y, m - 1, 1);
  const end   = new Date(y, m, 1);  // exclusive upper bound
  const label = start.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  return { start, end, label };
}

function prevMonth(now = new Date()): string {
  const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// ── CSV builder ───────────────────────────────────────────────────────────────

function csvRow(cells: (string | number | null | undefined)[]): string {
  return cells.map(c => {
    const s = c == null ? '' : String(c);
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? `"${s.replace(/"/g, '""')}"`
      : s;
  }).join(',');
}

function buildCsv(headers: string[], rows: (string | number | null | undefined)[][]): string {
  return [headers.join(','), ...rows.map(csvRow)].join('\n');
}

// ── ZIP helper ────────────────────────────────────────────────────────────────

function createZipBuffer(files: Array<{ name: string; data: Buffer }>): Buffer {
  const zip = new AdmZip();
  for (const { name, data } of files) {
    zip.addFile(name, data);
  }
  return zip.toBuffer();
}

// ── Puppeteer PDF ─────────────────────────────────────────────────────────────

async function buildPdfFromHtml(html: string): Promise<Buffer> {
  const puppeteer = await import('puppeteer');
  const browser = await puppeteer.default.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'domcontentloaded' });
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '18mm', bottom: '18mm', left: '16mm', right: '16mm' },
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}

// ── Summary HTML ──────────────────────────────────────────────────────────────

interface SummaryData {
  companyName: string;
  monthLabel:  string;
  generatedAt: string;
  revenue:     number;    // pence
  outstanding: number;    // pence
  expenses:    number;    // pence (PO totals)
  cisDeducted: number;    // pence
  invoiceCount: number;
  paymentCount: number;
}

function buildSummaryHtml(d: SummaryData): string {
  const gbp = (p: number) =>
    new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(p / 100);

  const tile = (label: string, value: string, colour: string) => `
    <div style="background:#f8fafc;border-radius:10px;padding:18px;border:1px solid #e2e8f0;text-align:center;">
      <div style="font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:.6px;margin-bottom:6px;">${label}</div>
      <div style="font-size:24px;font-weight:700;color:${colour};">${value}</div>
    </div>`;

  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
  <style>* { margin:0;padding:0;box-sizing:border-box; } body { font-family:Arial,sans-serif;font-size:13px;color:#374151;background:#fff; } @page { size:A4;margin:0; }</style>
  </head><body>
  <div style="background:linear-gradient(135deg,#0f172a,#1e293b);padding:28px 32px;">
    <div style="color:#94a3b8;font-size:11px;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">Accountant Pack — Monthly Summary</div>
    <div style="color:#fff;font-size:20px;font-weight:700;">${d.companyName}</div>
    <div style="color:#64748b;font-size:12px;margin-top:4px;">${d.monthLabel}</div>
    <div style="color:#475569;font-size:11px;margin-top:4px;">Generated ${d.generatedAt} · Powered by Vantro</div>
  </div>
  <div style="padding:28px 32px;">
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;margin-bottom:24px;">
      ${tile('Revenue (invoiced)', gbp(d.revenue), '#059669')}
      ${tile('Outstanding', gbp(d.outstanding), '#d97706')}
      ${tile('Expenses (POs)', gbp(d.expenses), '#dc2626')}
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;margin-bottom:28px;">
      ${tile('CIS Deducted', d.cisDeducted > 0 ? gbp(d.cisDeducted) : '—', '#7c3aed')}
      ${tile('Invoices issued', String(d.invoiceCount), '#1f2937')}
      ${tile('Payments received', String(d.paymentCount), '#1f2937')}
    </div>
    <div style="border-top:1px solid #e5e7eb;padding-top:16px;">
      <p style="font-size:11px;color:#9ca3af;line-height:1.5;">
        This summary was generated automatically by Vantro. Revenue = total of invoices with issue date in this month.
        Expenses = total of purchase orders raised in this month. CIS figures relate to the CIS tax month of the same period.
        This document is for reference only — consult your accountant for statutory accounts.
      </p>
    </div>
  </div></body></html>`;
}

// ── Service ───────────────────────────────────────────────────────────────────

@Injectable()
export class AccountantPackService {
  private readonly logger = new Logger(AccountantPackService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly cisEngine: CisEngineService,
  ) {}

  // ── Main generation ───────────────────────────────────────────────────────

  async generate(companyId: string, month: string): Promise<{ url: string }> {
    this.logger.log(`Generating accountant pack for ${companyId} month ${month}`);

    const { start, end, label } = parseMonth(month);
    const files: Array<{ name: string; data: Buffer }> = [];

    const [company, invoices, payments, purchaseOrders] = await Promise.all([
      this.prisma.client.company.findUnique({
        where: { id: companyId },
        select: { name: true, logo_url: true },
      }),
      this.prisma.client.invoice.findMany({
        where: { company_id: companyId, issue_date: { gte: start, lt: end } },
        include: { customer: { select: { name: true } } },
        orderBy: { issue_date: 'asc' },
      }),
      this.prisma.client.invoicePayment.findMany({
        where: { company_id: companyId, payment_date: { gte: start, lt: end } },
        include: {
          invoice: { select: { invoice_number: true, customer: { select: { name: true } } } },
        },
        orderBy: { payment_date: 'asc' },
      }),
      this.prisma.client.purchaseOrder.findMany({
        where: { company_id: companyId, created_at: { gte: start, lt: end } },
        include: { supplier: { select: { name: true } } },
        orderBy: { created_at: 'asc' },
      }),
    ]);

    const fmt = (d: Date) => d.toLocaleDateString('en-GB');
    const gbp = (p: number) => (p / 100).toFixed(2);

    // 1. invoices.csv
    const invoiceCsv = buildCsv(
      ['Number', 'Date', 'Customer', 'Net (£)', 'VAT (£)', 'Gross (£)', 'Status', 'Paid Date'],
      invoices.map(i => [
        i.invoice_number,
        fmt(i.issue_date),
        i.customer?.name ?? '',
        gbp(i.subtotal_pence),
        gbp(i.vat_amount_pence),
        gbp(i.total_pence),
        i.status,
        i.paid_date ? fmt(i.paid_date) : '',
      ]),
    );
    files.push({ name: 'invoices.csv', data: Buffer.from(invoiceCsv, 'utf-8') });

    // 2. payments.csv
    const paymentCsv = buildCsv(
      ['Date', 'Invoice Number', 'Customer', 'Amount (£)', 'Method'],
      payments.map(p => [
        fmt(p.payment_date),
        p.invoice?.invoice_number ?? '',
        p.invoice?.customer?.name ?? '',
        gbp(p.amount_pence),
        p.payment_method ?? '',
      ]),
    );
    files.push({ name: 'payments.csv', data: Buffer.from(paymentCsv, 'utf-8') });

    // 3. purchase-orders.csv
    const poCsv = buildCsv(
      ['Date', 'PO Number', 'Supplier', 'Net (£)', 'VAT (£)', 'Gross (£)', 'Status'],
      purchaseOrders.map(po => [
        fmt(po.created_at),
        po.po_number,
        po.supplier?.name ?? '',
        gbp(po.subtotal_pence),
        gbp(po.total_pence - po.subtotal_pence),
        gbp(po.total_pence),
        po.status,
      ]),
    );
    files.push({ name: 'purchase-orders.csv', data: Buffer.from(poCsv, 'utf-8') });

    // 4. CIS payment & deduction statement PDFs (one per sub, skip if none)
    try {
      const cisSummary = await this.cisEngine.getMonthlySummary(companyId, month);
      if (!cisSummary.is_nil_return && cisSummary.subcontractors.length > 0) {
        for (const sub of cisSummary.subcontractors) {
          if (sub.payment_count === 0) continue;
          try {
            const pdsBuf = await this.cisEngine.generatePdsForSubcontractor(
              companyId, sub.subcontractor_id, month, 'Owner',
            );
            const safeName = sub.subcontractor_name.replace(/[^a-z0-9]/gi, '-').toLowerCase();
            files.push({ name: `cis-statement-${safeName}.pdf`, data: pdsBuf });
          } catch (e) {
            this.logger.warn(`CIS PDS failed for ${sub.subcontractor_id}: ${String(e)}`);
          }
        }
      }
    } catch {
      // No CIS activity for this month — skip silently
    }

    // 5. summary.pdf
    const totalRevenue    = invoices.reduce((s, i) => s + i.total_pence, 0);
    const totalOutstanding = invoices
      .filter(i => ['SENT', 'PART_PAID'].includes(i.status))
      .reduce((s, i) => s + i.amount_due_pence, 0);
    const totalExpenses   = purchaseOrders.reduce((s, p) => s + p.total_pence, 0);
    let cisDeducted       = 0;
    try {
      const s = await this.cisEngine.getMonthlySummary(companyId, month);
      cisDeducted = s.total_deductions_pence;
    } catch { /* no CIS */ }

    const summaryHtml = buildSummaryHtml({
      companyName:  company?.name ?? 'Your Company',
      monthLabel:   label,
      generatedAt:  new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }),
      revenue:      totalRevenue,
      outstanding:  totalOutstanding,
      expenses:     totalExpenses,
      cisDeducted,
      invoiceCount: invoices.length,
      paymentCount: payments.length,
    });

    const summaryBuf = await buildPdfFromHtml(summaryHtml);
    files.push({ name: 'summary.pdf', data: summaryBuf });

    // 6. Zip and upload
    const zipBuf = createZipBuffer(files);
    const key    = `exports/accountant-pack-${companyId}-${month}.zip`;
    const url    = await this.storage.uploadFile(zipBuf, key, 'application/zip');

    this.logger.log(`Accountant pack for ${companyId} ${month} uploaded → ${key}`);
    return { url };
  }

  // ── Email to accountant ───────────────────────────────────────────────────

  async emailToAccountant(
    companyId: string,
    month: string,
  ): Promise<{ success: boolean; recipient: string }> {
    const company = await this.prisma.client.company.findUnique({
      where: { id: companyId },
      select: { name: true, accountant_email: true },
    });

    if (!company?.accountant_email) {
      throw new Error('No accountant email configured. Set it in Settings → Accountant.');
    }

    const { url } = await this.generate(companyId, month);
    const { start, label } = parseMonth(month);

    const resendKey = process.env.RESEND_API_KEY;
    if (!resendKey) throw new Error('Resend API key not configured');

    const owner = await this.prisma.client.user.findFirst({
      where: { companyId, role: 'OWNER' },
      select: { email: true },
    });

    const resend = new Resend(resendKey);
    const { error } = await resend.emails.send({
      from: process.env.FROM_EMAIL ?? 'noreply@vantro.co.uk',
      to: company.accountant_email,
      replyTo: owner?.email,
      subject: `${company.name} — Accountant Pack ${label}`,
      html: `
        <p>Hi,</p>
        <p>Please find the monthly accountant pack for <strong>${company.name}</strong> for <strong>${label}</strong> at the link below.</p>
        <p>The pack includes:</p>
        <ul>
          <li>Invoices CSV</li>
          <li>Payments received CSV</li>
          <li>Purchase Orders CSV</li>
          <li>CIS Payment & Deduction Statements (where applicable)</li>
          <li>Monthly Summary PDF</li>
        </ul>
        <p><a href="${url}" style="display:inline-block;background:#1d4ed8;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:600;">Download Pack (${label})</a></p>
        <p style="color:#9ca3af;font-size:12px;margin-top:24px;">Sent automatically by Vantro · ${new Date().toLocaleDateString('en-GB')}</p>
      `,
    });

    if (error) throw new Error(error.message);

    this.logger.log(`Accountant pack ${month} emailed to ${company.accountant_email}`);
    return { success: true, recipient: company.accountant_email };
  }

  // ── Monthly cron: 5th at 08:00 — previous month's pack ───────────────────

  @Cron('0 8 5 * *')
  async runMonthlyPacks(): Promise<void> {
    this.logger.log('Running monthly accountant pack cron');

    const month = prevMonth();
    const companies = await this.prisma.client.company.findMany({
      where: { accountant_pack_auto: true, accountant_email: { not: null } },
      select: { id: true, name: true },
    });

    this.logger.log(`Sending accountant packs for ${companies.length} company/companies`);

    await Promise.allSettled(
      companies.map(async c => {
        try {
          await this.emailToAccountant(c.id, month);
          this.logger.log(`Pack sent for ${c.name} (${month})`);
        } catch (err) {
          this.logger.error(`Pack failed for ${c.name}: ${String(err)}`);
        }
      }),
    );
  }
}
