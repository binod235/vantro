import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { calcTaxMonth } from './cis.helpers';
import { buildPdsHtml } from './pds.pdf';
import { buildCis300Html } from './cis300.pdf';

export interface CisSubcontractorSummary {
  subcontractor_id:       string;
  subcontractor_name:     string;
  utr_number:             string | null;
  cis_status:             string;
  deduction_rate:         number;
  payment_count:          number;
  gross_amount_pence:     number;
  labour_amount_pence:    number;
  materials_amount_pence: number;
  deduction_amount_pence: number;
  net_payment_pence:      number;
}

export interface CisMonthlySummary {
  tax_month:       string;
  tax_month_label: string;
  period_start:    Date;
  period_end:      Date;
  deadline:        Date;

  subcontractor_count:    number;
  subcontractors:         CisSubcontractorSummary[];
  total_gross_pence:      number;
  total_labour_pence:     number;
  total_materials_pence:  number;
  total_deductions_pence: number;

  suffered_count:          number;
  total_suffered_pence:    number;
  net_cis_liability_pence: number;
  is_nil_return:           boolean;
  is_repayment:            boolean;
}

@Injectable()
export class CisEngineService {
  constructor(private readonly prisma: PrismaService) {}

  async getAvailableTaxMonths(companyId: string): Promise<string[]> {
    const [payments, suffered] = await Promise.all([
      this.prisma.client.subcontractorPayment.findMany({
        where:    { company_id: companyId },
        select:   { tax_month: true },
        distinct: ['tax_month'],
        orderBy:  { tax_month: 'desc' },
      }),
      this.prisma.client.cisSufferedDeduction.findMany({
        where:    { company_id: companyId },
        select:   { tax_month: true },
        distinct: ['tax_month'],
        orderBy:  { tax_month: 'desc' },
      }),
    ]);

    const months = new Set([
      ...payments.map(p => p.tax_month),
      ...suffered.map(s => s.tax_month),
    ]);

    return Array.from(months).sort().reverse();
  }

  async getMonthlySummary(companyId: string, taxMonth: string): Promise<CisMonthlySummary> {
    const [payments, sufferedDeductions] = await Promise.all([
      this.prisma.client.subcontractorPayment.findMany({
        where:   { company_id: companyId, tax_month: taxMonth },
        include: {
          subcontractor: {
            select: {
              id: true, name: true, utr_number: true,
              cis_status: true, deduction_rate: true,
            },
          },
        },
      }),
      this.prisma.client.cisSufferedDeduction.findMany({
        where: { company_id: companyId, tax_month: taxMonth },
      }),
    ]);

    const subMap = new Map<string, CisSubcontractorSummary>();
    for (const p of payments) {
      const existing = subMap.get(p.subcontractor_id);
      if (existing) {
        existing.payment_count          += 1;
        existing.gross_amount_pence     += p.gross_amount_pence;
        existing.labour_amount_pence    += p.labour_amount_pence;
        existing.materials_amount_pence += p.materials_amount_pence;
        existing.deduction_amount_pence += p.deduction_amount_pence;
        existing.net_payment_pence      += p.net_payment_pence;
      } else {
        subMap.set(p.subcontractor_id, {
          subcontractor_id:       p.subcontractor_id,
          subcontractor_name:     p.subcontractor?.name ?? 'Unknown',
          utr_number:             p.subcontractor?.utr_number ?? null,
          cis_status:             p.subcontractor?.cis_status ?? 'STANDARD',
          deduction_rate:         p.deduction_rate,
          payment_count:          1,
          gross_amount_pence:     p.gross_amount_pence,
          labour_amount_pence:    p.labour_amount_pence,
          materials_amount_pence: p.materials_amount_pence,
          deduction_amount_pence: p.deduction_amount_pence,
          net_payment_pence:      p.net_payment_pence,
        });
      }
    }
    const subcontractors = Array.from(subMap.values());

    const totalGross      = subcontractors.reduce((s, r) => s + r.gross_amount_pence, 0);
    const totalLabour     = subcontractors.reduce((s, r) => s + r.labour_amount_pence, 0);
    const totalMaterials  = subcontractors.reduce((s, r) => s + r.materials_amount_pence, 0);
    const totalDeductions = subcontractors.reduce((s, r) => s + r.deduction_amount_pence, 0);
    const totalSuffered   = sufferedDeductions.reduce((s, r) => s + r.deduction_amount_pence, 0);
    const netLiability    = totalDeductions - totalSuffered;

    const { periodStart, periodEnd, deadline } = this.calcPeriodDates(taxMonth);

    return {
      tax_month:       taxMonth,
      tax_month_label: this.formatTaxMonth(taxMonth),
      period_start:    periodStart,
      period_end:      periodEnd,
      deadline,
      subcontractor_count:     subcontractors.length,
      subcontractors,
      total_gross_pence:       totalGross,
      total_labour_pence:      totalLabour,
      total_materials_pence:   totalMaterials,
      total_deductions_pence:  totalDeductions,
      suffered_count:          sufferedDeductions.length,
      total_suffered_pence:    totalSuffered,
      net_cis_liability_pence: netLiability,
      is_nil_return:           subcontractors.length === 0 && sufferedDeductions.length === 0,
      is_repayment:            netLiability < 0,
    };
  }

  async getTaxYearSummary(companyId: string, taxYear: string) {
    const months = this.getTaxYearMonths(taxYear);
    const summaries = await Promise.all(
      months.map(m => this.getMonthlySummary(companyId, m)),
    );
    return {
      tax_year:               taxYear,
      months:                 summaries,
      total_deductions_pence: summaries.reduce((s, m) => s + m.total_deductions_pence, 0),
      total_suffered_pence:   summaries.reduce((s, m) => s + m.total_suffered_pence, 0),
      net_liability_pence:    summaries.reduce((s, m) => s + m.net_cis_liability_pence, 0),
    };
  }

  getCurrentTaxMonth(): string {
    return calcTaxMonth(new Date());
  }

  private calcPeriodDates(taxMonth: string) {
    const [yearStr, monthStr] = taxMonth.split('-');
    const year  = parseInt(yearStr!);
    const month = parseInt(monthStr!); // 1-indexed

    const periodStart = new Date(year, month - 1, 6);

    const endMonth = month === 12 ? 1 : month + 1;
    const endYear  = month === 12 ? year + 1 : year;
    const periodEnd = new Date(endYear, endMonth - 1, 5);

    const deadlineMonth = endMonth === 12 ? 1 : endMonth + 1;
    const deadlineYear  = endMonth === 12 ? endYear + 1 : endYear;
    const deadline = new Date(deadlineYear, deadlineMonth - 1, 19);

    return { periodStart, periodEnd, deadline };
  }

  formatTaxMonth(taxMonth: string): string {
    const [yearStr, monthStr] = taxMonth.split('-');
    const year  = parseInt(yearStr!);
    const month = parseInt(monthStr!);
    const startDate = new Date(year, month - 1, 6);
    const endMonth  = month === 12 ? 1 : month + 1;
    const endYear   = month === 12 ? year + 1 : year;
    const endDate   = new Date(endYear, endMonth - 1, 5);
    const fmt = (d: Date, opts: Intl.DateTimeFormatOptions) =>
      d.toLocaleDateString('en-GB', opts);
    return `6 ${fmt(startDate, { month: 'short' })} – 5 ${fmt(endDate, { month: 'short', year: 'numeric' })}`;
  }

  private getTaxYearMonths(taxYear: string): string[] {
    const startYear = parseInt(taxYear.split('-')[0]!);
    const months: string[] = [];
    for (let m = 4; m <= 12; m++) {
      months.push(`${startYear}-${String(m).padStart(2, '0')}`);
    }
    for (let m = 1; m <= 3; m++) {
      months.push(`${startYear + 1}-${String(m).padStart(2, '0')}`);
    }
    return months;
  }

  // ── Audit log ─────────────────────────────────────────────────────────────

  private async logAudit(
    companyId: string,
    action: string,
    opts: {
      tax_month?:          string;
      tax_year?:           string;
      subcontractor_name?: string;
      subcontractor_id?:   string;
      performed_by:        string;
      details?:            string;
    },
  ): Promise<void> {
    try {
      await this.prisma.client.cisAuditLog.create({
        data: {
          company_id:          companyId,
          action,
          tax_month:           opts.tax_month           ?? null,
          tax_year:            opts.tax_year            ?? null,
          subcontractor_name:  opts.subcontractor_name  ?? null,
          subcontractor_id:    opts.subcontractor_id    ?? null,
          performed_by:        opts.performed_by,
          details:             opts.details             ?? null,
        },
      });
    } catch { /* audit failure must never block the main operation */ }
  }

  async getAuditLog(companyId: string, taxMonth?: string, limit = 50) {
    return this.prisma.client.cisAuditLog.findMany({
      where: {
        company_id: companyId,
        ...(taxMonth ? { tax_month: taxMonth } : {}),
      },
      orderBy: { created_at: 'desc' },
      take:    limit,
    });
  }

  // ── CIS300 PDF + CSV + submission tracking ───────────────────────────────

  async generateCis300Pdf(companyId: string, taxMonth: string, performedBy = 'Owner'): Promise<Buffer> {
    const [company, summary] = await Promise.all([
      this.prisma.client.company.findUnique({ where: { id: companyId } }),
      this.getMonthlySummary(companyId, taxMonth),
    ]);
    if (!company) throw new NotFoundException('Company not found');

    const coAddr = [company.address_line1, company.city, company.postcode]
      .filter(Boolean).join(', ');

    const html = buildCis300Html({
      contractor_name:        company.name,
      contractor_utr:         company.cis_number              ?? null,
      accounts_office_ref:    company.cis_accounts_office_ref ?? null,
      contractor_address:     coAddr                          || null,
      logo_url:               company.logo_url                ?? null,
      accent_colour:          company.invoice_accent_colour   ?? null,
      tax_month:              taxMonth,
      tax_month_label:        summary.tax_month_label,
      period_start:           summary.period_start.toISOString(),
      period_end:             summary.period_end.toISOString(),
      deadline:               summary.deadline.toISOString(),
      generated_at:           new Date(),
      subcontractors:         summary.subcontractors.map(s => ({
        name:                   s.subcontractor_name,
        utr_number:             s.utr_number,
        verification_number:    null,
        cis_status:             s.cis_status,
        deduction_rate:         s.deduction_rate,
        gross_amount_pence:     s.gross_amount_pence,
        materials_amount_pence: s.materials_amount_pence,
        labour_amount_pence:    s.labour_amount_pence,
        deduction_amount_pence: s.deduction_amount_pence,
      })),
      total_gross_pence:      summary.total_gross_pence,
      total_materials_pence:  summary.total_materials_pence,
      total_labour_pence:     summary.total_labour_pence,
      total_deductions_pence: summary.total_deductions_pence,
      total_suffered_pence:   summary.total_suffered_pence,
      net_liability_pence:    summary.net_cis_liability_pence,
      is_nil_return:          summary.is_nil_return,
      is_repayment:           summary.is_repayment,
    });

    const puppeteer = await import('puppeteer');
    const browser   = await puppeteer.default.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });
    let pdfBuffer: Buffer;
    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'domcontentloaded' });
      pdfBuffer = Buffer.from(await page.pdf({
        format: 'A4', printBackground: true,
        margin: { top: '10mm', bottom: '10mm', left: '0', right: '0' },
      }));
    } finally {
      await browser.close();
    }
    void this.logAudit(companyId, 'CIS300_PDF_GENERATED', {
      tax_month:    taxMonth,
      performed_by: performedBy,
      details:      `${summary.subcontractor_count} subcontractor(s)`,
    });
    return pdfBuffer;
  }

  async generateCis300Csv(companyId: string, taxMonth: string, performedBy = 'Owner'): Promise<string> {
    const [company, summary] = await Promise.all([
      this.prisma.client.company.findUnique({
        where:  { id: companyId },
        select: { name: true, cis_number: true },
      }),
      this.getMonthlySummary(companyId, taxMonth),
    ]);

    const gbp = (p: number) => (p / 100).toFixed(2);
    const rows: string[][] = [];

    rows.push(['CIS Monthly Return (CIS300)']);
    rows.push(['Contractor', company?.name ?? '']);
    rows.push(['Contractor UTR', company?.cis_number ?? '']);
    rows.push(['Tax Month', summary.tax_month_label]);
    rows.push(['Deadline', new Date(summary.deadline).toLocaleDateString('en-GB')]);
    rows.push([]);
    rows.push([
      'Subcontractor', 'UTR', 'CIS Status', 'Rate %',
      'Gross (£)', 'Materials (£)', 'Labour (£)', 'CIS Deducted (£)',
    ]);

    for (const sub of summary.subcontractors) {
      rows.push([
        sub.subcontractor_name,
        sub.utr_number ?? 'MISSING',
        sub.cis_status,
        String(sub.deduction_rate),
        gbp(sub.gross_amount_pence),
        gbp(sub.materials_amount_pence),
        gbp(sub.labour_amount_pence),
        gbp(sub.deduction_amount_pence),
      ]);
    }

    rows.push([]);
    rows.push([
      'TOTALS', '', '', '',
      gbp(summary.total_gross_pence),
      gbp(summary.total_materials_pence),
      gbp(summary.total_labour_pence),
      gbp(summary.total_deductions_pence),
    ]);

    if (summary.total_suffered_pence > 0) {
      rows.push([]);
      rows.push(['CIS Suffered (deducted from your own payments)', gbp(summary.total_suffered_pence)]);
      rows.push(['Net CIS Liability', gbp(summary.net_cis_liability_pence)]);
    }

    if (summary.is_nil_return) {
      rows.push(['NIL RETURN — no subcontractors paid this period']);
    }

    void this.logAudit(companyId, 'CIS300_CSV_EXPORTED', {
      tax_month:    taxMonth,
      performed_by: performedBy,
      details:      `${summary.subcontractor_count} subcontractor(s)`,
    });

    return rows
      .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');
  }

  async markSubmitted(
    companyId: string,
    taxMonth:  string,
    _userId:   string,
    userName:  string,
    dto: { hmrc_reference?: string; notes?: string },
  ) {
    const summary = await this.getMonthlySummary(companyId, taxMonth);

    const result = await this.prisma.client.cisMonthlyReturn.upsert({
      where:  { company_id_tax_month: { company_id: companyId, tax_month: taxMonth } },
      create: {
        company_id:             companyId,
        tax_month:              taxMonth,
        status:                 'SUBMITTED',
        submitted_at:           new Date(),
        submitted_by:           userName,
        hmrc_reference:         dto.hmrc_reference ?? null,
        notes:                  dto.notes          ?? null,
        total_gross_pence:      summary.total_gross_pence,
        total_deductions_pence: summary.total_deductions_pence,
        subcontractor_count:    summary.subcontractor_count,
        is_nil_return:          summary.is_nil_return,
      },
      update: {
        status:         'SUBMITTED',
        submitted_at:   new Date(),
        submitted_by:   userName,
        hmrc_reference: dto.hmrc_reference ?? null,
        notes:          dto.notes          ?? null,
      },
    });

    void this.logAudit(companyId, 'RETURN_SUBMITTED', {
      tax_month:    taxMonth,
      performed_by: userName,
      details:      dto.hmrc_reference ? `HMRC ref: ${dto.hmrc_reference}` : undefined,
    });

    return result;
  }

  async getSubmissionStatus(companyId: string, taxMonth: string) {
    return this.prisma.client.cisMonthlyReturn.findUnique({
      where: { company_id_tax_month: { company_id: companyId, tax_month: taxMonth } },
    });
  }

  // ── PDS PDF generation ────────────────────────────────────────────────────

  async generatePdsForSubcontractor(
    companyId:       string,
    subcontractorId: string,
    taxMonth:        string,
    performedBy = 'Owner',
  ): Promise<Buffer> {
    const [company, sub, payments] = await Promise.all([
      this.prisma.client.company.findUnique({ where: { id: companyId } }),
      this.prisma.client.subcontractor.findFirst({
        where: { id: subcontractorId, company_id: companyId },
      }),
      this.prisma.client.subcontractorPayment.findMany({
        where:   { company_id: companyId, subcontractor_id: subcontractorId, tax_month: taxMonth },
        orderBy: { payment_date: 'asc' },
      }),
    ]);

    if (!company) throw new NotFoundException('Company not found');
    if (!sub)     throw new NotFoundException('Subcontractor not found');
    if (payments.length === 0) {
      throw new NotFoundException('No payments found for this subcontractor in this period');
    }

    const totals = payments.reduce(
      (acc, p) => ({
        gross:     acc.gross     + p.gross_amount_pence,
        labour:    acc.labour    + p.labour_amount_pence,
        materials: acc.materials + p.materials_amount_pence,
        deduction: acc.deduction + p.deduction_amount_pence,
        net:       acc.net       + p.net_payment_pence,
      }),
      { gross: 0, labour: 0, materials: 0, deduction: 0, net: 0 },
    );

    const { periodStart, periodEnd } = this.calcPeriodDates(taxMonth);
    const contractorAddress = [company.address_line1, company.city, company.postcode]
      .filter(Boolean).join(', ');

    const html = buildPdsHtml({
      contractor_name:    company.name,
      contractor_utr:     company.cis_number ?? null,
      contractor_address: contractorAddress || null,
      contractor_phone:   company.phone     ?? null,
      logo_url:           company.logo_url  ?? null,
      accent_colour:      company.invoice_accent_colour ?? null,
      subcontractor_name: sub.name,
      subcontractor_utr:  sub.utr_number ?? null,
      cis_status:         sub.cis_status,
      deduction_rate:     sub.deduction_rate,
      tax_month:          taxMonth,
      tax_month_label:    this.formatTaxMonth(taxMonth),
      period_start:       periodStart.toISOString(),
      period_end:         periodEnd.toISOString(),
      issue_date:         new Date(),
      payments:           payments.map(p => ({
        payment_date:           p.payment_date.toISOString(),
        description:            p.description,
        invoice_ref:            p.invoice_ref,
        gross_amount_pence:     p.gross_amount_pence,
        labour_amount_pence:    p.labour_amount_pence,
        materials_amount_pence: p.materials_amount_pence,
        vat_amount_pence:       p.vat_amount_pence,
        equipment_hire_pence:   p.equipment_hire_pence,
        deduction_amount_pence: p.deduction_amount_pence,
        net_payment_pence:      p.net_payment_pence,
      })),
      total_gross_pence:     totals.gross,
      total_labour_pence:    totals.labour,
      total_materials_pence: totals.materials,
      total_deduction_pence: totals.deduction,
      total_net_pence:       totals.net,
    });

    const puppeteer = await import('puppeteer');
    const browser   = await puppeteer.default.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });
    let pdfBuf: Buffer;
    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'domcontentloaded' });
      const pdf = await page.pdf({
        format:          'A4',
        printBackground: true,
        margin: { top: '10mm', bottom: '10mm', left: '0', right: '0' },
      });
      pdfBuf = Buffer.from(pdf);
    } finally {
      await browser.close();
    }
    void this.logAudit(companyId, 'PDS_GENERATED', {
      tax_month:          taxMonth,
      subcontractor_id:   subcontractorId,
      subcontractor_name: sub.name,
      performed_by:       performedBy,
    });
    return pdfBuf;
  }

  async sendPdsEmail(
    companyId:       string,
    subcontractorId: string,
    taxMonth:        string,
    performedBy = 'Owner',
  ): Promise<{ sent: boolean }> {
    const [company, sub] = await Promise.all([
      this.prisma.client.company.findUnique({ where: { id: companyId } }),
      this.prisma.client.subcontractor.findFirst({
        where: { id: subcontractorId, company_id: companyId },
      }),
    ]);

    if (!sub) throw new NotFoundException('Subcontractor not found');
    if (!sub.email) {
      throw new BadRequestException(
        'Subcontractor has no email address. Add one before sending.',
      );
    }

    const [pdfBuffer] = await Promise.all([
      this.generatePdsForSubcontractor(companyId, subcontractorId, taxMonth),
    ]);

    const taxMonthLabel = this.formatTaxMonth(taxMonth);
    const { Resend }    = await import('resend');
    const resend        = new Resend(process.env.RESEND_API_KEY);

    const { error } = await resend.emails.send({
      from:    process.env.FROM_EMAIL ?? 'noreply@vantro.co.uk',
      to:      sub.email,
      subject: `CIS Payment & Deduction Statement — ${taxMonthLabel}`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
          <h2>CIS Payment &amp; Deduction Statement</h2>
          <p>Dear ${sub.name},</p>
          <p>Please find attached your CIS Payment and Deduction Statement
          for the period <strong>${taxMonthLabel}</strong>
          from <strong>${company?.name ?? 'your contractor'}</strong>.</p>
          <p style="color:#555;font-size:13px;">
            This statement shows the gross payments made to you, any CIS deductions
            applied, and the net amount paid. Please retain this for your tax records.
          </p>
          <p style="color:#888;font-size:12px;margin-top:20px;">
            If you have any questions, please contact ${company?.name ?? 'us'}
            ${company?.phone ? `on ${company.phone}` : 'directly'}.
          </p>
        </div>
      `,
      attachments: [{
        filename: `CIS-Statement-${sub.name.replace(/\s+/g, '-')}-${taxMonth}.pdf`,
        content:  pdfBuffer,
      }],
    });

    if (error) throw new Error(`Email failed: ${error.message}`);

    void this.logAudit(companyId, 'PDS_EMAIL_SENT', {
      tax_month:          taxMonth,
      subcontractor_id:   subcontractorId,
      subcontractor_name: sub.name,
      performed_by:       performedBy,
      details:            sub.email ?? undefined,
    });

    return { sent: true };
  }

  // ── Annual reconciliation CSV export ─────────────────────────────────────

  async generateAnnualReconciliationCsv(
    companyId:   string,
    taxYear:     string,
    performedBy = 'Owner',
  ): Promise<string> {
    const [company, yearSummary] = await Promise.all([
      this.prisma.client.company.findUnique({
        where:  { id: companyId },
        select: { name: true, cis_number: true },
      }),
      this.getTaxYearSummary(companyId, taxYear),
    ]);

    const gbp  = (p: number) => (p / 100).toFixed(2);
    const rows: string[][] = [];
    const [startYear, endYear] = taxYear.split('-');

    rows.push(['CIS Annual Reconciliation Report']);
    rows.push(['Contractor', company?.name ?? '']);
    rows.push(['Contractor UTR', company?.cis_number ?? '']);
    rows.push(['Tax Year', `${taxYear} (6 April ${startYear ?? ''} to 5 April ${endYear ?? ''})`]);
    rows.push(['Generated', new Date().toLocaleDateString('en-GB')]);
    rows.push([]);

    let hasActivity = false;

    for (const m of yearSummary.months) {
      if (m.subcontractors.length === 0 && m.suffered_count === 0) continue;
      hasActivity = true;

      rows.push([`── ${m.tax_month_label} ──`]);

      if (m.is_nil_return) {
        rows.push(['NIL RETURN — no payments or suffered deductions this period']);
        rows.push([]);
        continue;
      }

      if (m.subcontractors.length > 0) {
        rows.push([
          'Subcontractor', 'UTR', 'CIS Status', 'Rate %',
          'Gross (£)', 'Materials (£)', 'Labour (£)',
          'CIS Deducted (£)', 'Net Paid (£)',
        ]);
        for (const sub of m.subcontractors) {
          const materialsOnly = sub.labour_amount_pence === 0 && sub.gross_amount_pence > 0;
          rows.push([
            sub.subcontractor_name,
            sub.utr_number ?? 'MISSING — required for CIS300',
            materialsOnly ? 'MATERIALS ONLY (no deduction)' : sub.cis_status,
            String(sub.deduction_rate),
            gbp(sub.gross_amount_pence),
            gbp(sub.materials_amount_pence),
            gbp(sub.labour_amount_pence),
            gbp(sub.deduction_amount_pence),
            gbp(sub.net_payment_pence),
          ]);
        }
        rows.push([
          'Month Total', '', '', '',
          gbp(m.total_gross_pence),
          gbp(m.total_materials_pence),
          gbp(m.total_labour_pence),
          gbp(m.total_deductions_pence),
          '',
        ]);
      }

      if (m.suffered_count > 0) {
        rows.push([
          `CIS Suffered (${m.suffered_count} record${m.suffered_count !== 1 ? 's' : ''})`,
          gbp(m.total_suffered_pence),
        ]);
      }

      rows.push([
        'Net CIS liability this month',
        gbp(m.net_cis_liability_pence),
        m.is_repayment ? '← REPAYMENT DUE FROM HMRC' : '',
      ]);
      rows.push([]);
    }

    if (!hasActivity) {
      rows.push(['No CIS activity recorded for this tax year']);
      rows.push([]);
    }

    rows.push(['── ANNUAL TOTALS ──']);
    rows.push(['Total CIS deducted from subcontractors', gbp(yearSummary.total_deductions_pence)]);
    rows.push(['Total CIS suffered (deducted from you)', gbp(yearSummary.total_suffered_pence)]);
    rows.push(['Net CIS liability', gbp(yearSummary.net_liability_pence)]);

    if (yearSummary.net_liability_pence < 0) {
      rows.push(['', '← HMRC owe you this amount for the year']);
    }

    void this.logAudit(companyId, 'ANNUAL_CSV_EXPORTED', {
      tax_year:     taxYear,
      performed_by: performedBy,
      details:      `${yearSummary.months.filter(m => !m.is_nil_return).length} active month(s)`,
    });

    return rows
      .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');
  }
}
