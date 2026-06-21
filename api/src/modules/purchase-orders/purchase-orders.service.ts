import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Resend } from 'resend';
import { PrismaService } from '../../prisma/prisma.service';

interface POLineItem {
  description:      string;
  quantity:         number;
  unit_cost_pence:  number;
  total_cost_pence: number;
}

const PO_INCLUDE = {
  supplier: { select: { id: true, name: true, email: true, phone: true, address_line1: true, city: true, postcode: true } },
  job:      { select: { id: true, title: true } },
} as const;

@Injectable()
export class PurchaseOrdersService {
  private readonly logger = new Logger(PurchaseOrdersService.name);

  constructor(private readonly prisma: PrismaService) {}

  private async verifyJob(jobId: string, companyId: string) {
    const job = await this.prisma.client.job.findFirst({
      where: { id: jobId, company_id: companyId },
    });
    if (!job) throw new NotFoundException('Job not found');
  }

  private async verifySupplier(supplierId: string, companyId: string) {
    const supplier = await this.prisma.client.supplier.findFirst({
      where: { id: supplierId, company_id: companyId },
    });
    if (!supplier) throw new NotFoundException('Supplier not found');
  }

  private async generatePoNumber(
    tx: Parameters<Parameters<typeof this.prisma.client.$transaction>[0]>[0],
    companyId: string,
  ): Promise<string> {
    const company = await tx.company.findUnique({
      where:  { id: companyId },
      select: { po_prefix: true, po_next_number: true },
    });
    if (!company) throw new NotFoundException('Company not found');
    const number = `${company.po_prefix}-${String(company.po_next_number).padStart(3, '0')}`;
    await tx.company.update({
      where: { id: companyId },
      data:  { po_next_number: { increment: 1 } },
    });
    return number;
  }

  private processItems(raw: Omit<POLineItem, 'total_cost_pence'>[]): POLineItem[] {
    return raw.map(item => ({
      ...item,
      total_cost_pence: Math.round(item.quantity * item.unit_cost_pence),
    }));
  }

  private calcSubtotal(items: POLineItem[]): number {
    return items.reduce((s, i) => s + i.total_cost_pence, 0);
  }

  async list(companyId: string, filters?: { job_id?: string; status?: string }) {
    const where: Record<string, unknown> = { company_id: companyId };
    if (filters?.job_id) where.job_id = filters.job_id;
    if (filters?.status) where.status = filters.status;
    return this.prisma.client.purchaseOrder.findMany({
      where,
      include:  PO_INCLUDE,
      orderBy:  { created_at: 'desc' },
    });
  }

  async getOne(companyId: string, poId: string) {
    const po = await this.prisma.client.purchaseOrder.findFirst({
      where:   { id: poId, company_id: companyId },
      include: PO_INCLUDE,
    });
    if (!po) throw new NotFoundException('Purchase order not found');
    return po;
  }

  async create(companyId: string, dto: {
    job_id?:        string;
    supplier_id?:   string;
    line_items:     Omit<POLineItem, 'total_cost_pence'>[];
    notes?:         string;
    expected_date?: string;
  }) {
    if (dto.job_id) await this.verifyJob(dto.job_id, companyId);
    if (dto.supplier_id) await this.verifySupplier(dto.supplier_id, companyId);

    const items    = this.processItems(dto.line_items);
    const subtotal = this.calcSubtotal(items);

    return this.prisma.client.$transaction(async (tx) => {
      const poNumber = await this.generatePoNumber(tx, companyId);
      return tx.purchaseOrder.create({
        data: {
          company_id:     companyId,
          job_id:         dto.job_id       ?? null,
          supplier_id:    dto.supplier_id  ?? null,
          po_number:      poNumber,
          line_items:     items as never,
          subtotal_pence: subtotal,
          total_pence:    subtotal,
          notes:          dto.notes        ?? null,
          expected_date:  dto.expected_date ? new Date(dto.expected_date) : null,
        },
        include: PO_INCLUDE,
      });
    });
  }

  async update(companyId: string, poId: string, dto: {
    supplier_id?:   string | null;
    job_id?:        string | null;
    line_items?:    Omit<POLineItem, 'total_cost_pence'>[];
    notes?:         string;
    expected_date?: string;
  }) {
    const po = await this.getOne(companyId, poId);
    if (po.status === 'RECEIVED') {
      throw new BadRequestException('Cannot edit a received purchase order');
    }
    if (dto.job_id) await this.verifyJob(dto.job_id, companyId);
    if (dto.supplier_id) await this.verifySupplier(dto.supplier_id, companyId);

    const rawItems = dto.line_items ?? (po.line_items as unknown as POLineItem[]);
    const items    = this.processItems(rawItems);
    const subtotal = this.calcSubtotal(items);

    return this.prisma.client.purchaseOrder.update({
      where: { id: poId },
      data: {
        supplier_id:    dto.supplier_id !== undefined ? dto.supplier_id   : po.supplier_id,
        job_id:         dto.job_id      !== undefined ? dto.job_id        : po.job_id,
        line_items:     items as never,
        subtotal_pence: subtotal,
        total_pence:    subtotal,
        notes:          dto.notes         !== undefined ? dto.notes        : po.notes,
        expected_date:  dto.expected_date ? new Date(dto.expected_date) : po.expected_date,
      },
      include: PO_INCLUDE,
    });
  }

  async markReceived(companyId: string, poId: string) {
    const po = await this.getOne(companyId, poId);
    if (po.status === 'CANCELLED') {
      throw new BadRequestException('Cannot receive a cancelled purchase order');
    }
    return this.prisma.client.purchaseOrder.update({
      where: { id: poId },
      data: {
        status:        'RECEIVED',
        received_date: new Date(),
      },
      include: PO_INCLUDE,
    });
  }

  async cancel(companyId: string, poId: string) {
    const po = await this.getOne(companyId, poId);
    if (po.status === 'RECEIVED') {
      throw new BadRequestException('Cannot cancel a received purchase order');
    }
    return this.prisma.client.purchaseOrder.update({
      where: { id: poId },
      data:  { status: 'CANCELLED' },
      include: PO_INCLUDE,
    });
  }

  async remove(companyId: string, poId: string): Promise<void> {
    const po = await this.getOne(companyId, poId);
    if (po.status !== 'DRAFT') {
      throw new BadRequestException('Only draft purchase orders can be deleted');
    }
    await this.prisma.client.purchaseOrder.delete({ where: { id: poId } });
  }

  async generatePdf(companyId: string, poId: string): Promise<Buffer> {
    const po      = await this.getOne(companyId, poId);
    const company = await this.prisma.client.company.findUnique({
      where: { id: companyId },
      omit:  { stripe_customer_id: true, stripe_subscription_id: true },
    });
    if (!company) throw new NotFoundException('Company not found');

    const { buildPoHtml } = await import('./po.pdf.js');
    const html = buildPoHtml(po as never, company as never);

    const puppeteer = await import('puppeteer');
    const browser   = await puppeteer.default.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });
    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'domcontentloaded' });
      const pdf = await page.pdf({
        format:          'A4',
        printBackground: true,
        margin: { top: '20mm', bottom: '20mm', left: '15mm', right: '15mm' },
      });
      return Buffer.from(pdf);
    } finally {
      await browser.close();
    }
  }

  async sendToSupplier(companyId: string, poId: string) {
    const po      = await this.getOne(companyId, poId);
    const company = await this.prisma.client.company.findUnique({ where: { id: companyId } });
    if (!company) throw new NotFoundException('Company not found');
    if (!po.supplier?.email) {
      throw new BadRequestException('Supplier has no email address');
    }

    const resendKey = process.env.RESEND_API_KEY;
    if (!resendKey) throw new BadRequestException('Email service not configured');

    let pdfBuffer: Buffer | undefined;
    try { pdfBuffer = await this.generatePdf(companyId, poId); }
    catch (err) { this.logger.warn(`PDF failed for PO ${poId}: ${String(err)}`); }

    const gbp = (p: number) =>
      new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(p / 100);

    const resend = new Resend(resendKey);
    const { error } = await resend.emails.send({
      from:    process.env.FROM_EMAIL ?? 'noreply@vantro.co.uk',
      to:      po.supplier.email,
      subject: `Purchase Order ${po.po_number} from ${company.name}`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
          <h2 style="color:#111;">Purchase Order from ${company.name}</h2>
          <p>Please find purchase order <strong>${po.po_number}</strong> attached.</p>
          <table style="font-size:14px;border-collapse:collapse;margin:16px 0;">
            <tr><td style="color:#888;padding:4px 20px 4px 0;">PO Number</td><td><strong>${po.po_number}</strong></td></tr>
            <tr><td style="color:#888;padding:4px 20px 4px 0;">Total</td><td><strong>${gbp(po.total_pence)}</strong></td></tr>
            ${po.expected_date ? `<tr><td style="color:#888;padding:4px 20px 4px 0;">Required By</td><td><strong>${new Date(po.expected_date).toLocaleDateString('en-GB')}</strong></td></tr>` : ''}
            ${po.job ? `<tr><td style="color:#888;padding:4px 20px 4px 0;">Job Reference</td><td>${po.job.title}</td></tr>` : ''}
          </table>
          ${po.notes ? `<p style="color:#555;">${po.notes}</p>` : ''}
          <p style="color:#888;font-size:12px;">This purchase order was sent via Vantro.</p>
        </div>
      `,
      ...(pdfBuffer ? {
        attachments: [{
          filename: `${po.po_number}.pdf`,
          content:  pdfBuffer,
        }],
      } : {}),
    });

    if (error) throw new Error(`Failed to send PO email: ${error.message}`);

    await this.prisma.client.purchaseOrder.update({
      where: { id: poId },
      data: {
        status:       po.status === 'DRAFT' ? 'SENT' : po.status,
        last_sent_at: new Date(),
      },
    });

    this.logger.log(`PO ${po.po_number} sent to ${po.supplier.email}`);
    return { sent: true };
  }

  async getJobCosting(companyId: string, jobId: string) {
    const [job, timesheets, purchaseOrders, invoices] = await Promise.all([
      this.prisma.client.job.findFirst({
        where:   { id: jobId, company_id: companyId },
        include: { customer: { select: { name: true } } },
      }),
      this.prisma.client.timesheet.findMany({
        where: { job_id: jobId, company_id: companyId },
      }),
      this.prisma.client.purchaseOrder.findMany({
        where:   { job_id: jobId, company_id: companyId },
        include: { supplier: { select: { name: true } } },
      }),
      this.prisma.client.invoice.findMany({
        where: { job_id: jobId, company_id: companyId },
      }),
    ]);

    if (!job) throw new NotFoundException('Job not found');

    const totalInvoiced = invoices.reduce((s, i) => s + i.total_pence, 0);
    const totalPaid     = invoices
      .filter(i => i.status === 'PAID')
      .reduce((s, i) => s + i.total_pence, 0);

    const totalLabourPence   = timesheets.reduce((s, t) => s + t.total_pence, 0);
    const totalLabourMinutes = timesheets.reduce((s, t) => s + t.duration_minutes, 0);

    const totalMaterialsPence = purchaseOrders
      .filter(po => po.status === 'RECEIVED')
      .reduce((s, po) => s + po.total_pence, 0);

    const totalPendingMaterials = purchaseOrders
      .filter(po => ['DRAFT', 'SENT'].includes(po.status))
      .reduce((s, po) => s + po.total_pence, 0);

    const totalCost   = totalLabourPence + totalMaterialsPence;
    const grossProfit = totalInvoiced - totalCost;
    const marginPct   = totalInvoiced > 0
      ? Math.round((grossProfit / totalInvoiced) * 100)
      : 0;

    return {
      job: {
        id:       job.id,
        title:    job.title,
        customer: job.customer?.name,
        status:   job.status,
      },
      revenue: {
        total_invoiced_pence: totalInvoiced,
        total_paid_pence:     totalPaid,
      },
      labour: {
        total_pence:   totalLabourPence,
        total_minutes: totalLabourMinutes,
        entries:       timesheets.length,
      },
      materials: {
        received_pence: totalMaterialsPence,
        pending_pence:  totalPendingMaterials,
        po_count:       purchaseOrders.length,
      },
      profitability: {
        total_cost_pence:   totalCost,
        gross_profit_pence: grossProfit,
        margin_percent:     marginPct,
      },
    };
  }

  async getJobCostingReport(companyId: string) {
    const jobs = await this.prisma.client.job.findMany({
      where:   { company_id: companyId },
      include: {
        customer:       { select: { name: true } },
        invoices:       { select: { total_pence: true, status: true } },
        timesheets:     { select: { total_pence: true, duration_minutes: true } },
        purchaseOrders: { select: { total_pence: true, status: true } },
      },
      orderBy: { created_at: 'desc' },
    });

    return jobs.map(job => {
      const invoiced  = job.invoices.reduce((s, i) => s + i.total_pence, 0);
      const labour    = job.timesheets.reduce((s, t) => s + t.total_pence, 0);
      const materials = job.purchaseOrders
        .filter(po => po.status === 'RECEIVED')
        .reduce((s, po) => s + po.total_pence, 0);
      const totalCost = labour + materials;
      const profit    = invoiced - totalCost;
      const margin    = invoiced > 0 ? Math.round((profit / invoiced) * 100) : 0;

      return {
        id:               job.id,
        title:            job.title,
        status:           job.status,
        customer_name:    job.customer?.name ?? '—',
        invoiced_pence:   invoiced,
        labour_pence:     labour,
        materials_pence:  materials,
        total_cost_pence: totalCost,
        profit_pence:     profit,
        margin_percent:   margin,
      };
    });
  }
}
