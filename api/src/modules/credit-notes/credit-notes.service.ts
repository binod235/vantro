import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Resend } from 'resend';
import { PrismaService } from '../../prisma/prisma.service';
import { CommsService }  from '../comms/comms.service';
import type { CreateCreditNoteDto } from './dto/create-credit-note.dto';
import type { UpdateCreditNoteDto } from './dto/update-credit-note.dto';

// ─── Line item types ──────────────────────────────────────────────────────────
// Deliberately simpler than Invoice line items — no reverse charge, no VAT
// type variants, just a flat vat_rate per line. See CreditNote model comment.

interface InputLineItem {
  description: string;
  quantity: number;
  unit_price_pence: number;
  vat_rate: number;
}

interface CalculatedLineItem extends InputLineItem {
  id: string;
  net_pence: number;
  vat_pence: number;
}

interface CreditNoteTotals {
  subtotal_pence: number;
  vat_amount_pence: number;
  total_pence: number;
}

// ─── Calculation helpers ──────────────────────────────────────────────────────

function calcLineItem(item: InputLineItem, index: number): CalculatedLineItem {
  const net = Math.round(item.quantity * item.unit_price_pence);
  const vat = Math.round((net * item.vat_rate) / 100);
  return { ...item, id: `item_${index}`, net_pence: net, vat_pence: vat };
}

function calcTotals(items: CalculatedLineItem[]): CreditNoteTotals {
  const subtotal = items.reduce((s, i) => s + i.net_pence, 0);
  const vat = items.reduce((s, i) => s + i.vat_pence, 0);
  return { subtotal_pence: subtotal, vat_amount_pence: vat, total_pence: subtotal + vat };
}

// ─── Prisma include ───────────────────────────────────────────────────────────

const CREDIT_NOTE_INCLUDE = {
  customer: { select: { id: true, name: true, email: true, phone: true, address_line1: true, address_line2: true, city: true, postcode: true } },
  invoice: { select: { id: true, invoice_number: true, status: true, total_pence: true, amount_due_pence: true, customer_id: true } },
} as const;

@Injectable()
export class CreditNotesService {
  private readonly logger = new Logger(CreditNotesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly comms: CommsService,
  ) {}

  // ── Helpers ────────────────────────────────────────────────────────────────

  private async verifyCustomer(customerId: string, companyId: string) {
    const c = await this.prisma.client.customer.findFirst({
      where: { id: customerId, company_id: companyId },
    });
    if (!c) throw new NotFoundException('Customer not found');
    return c;
  }

  private async verifyInvoice(invoiceId: string, companyId: string, customerId: string) {
    const inv = await this.prisma.client.invoice.findFirst({
      where: { id: invoiceId, company_id: companyId },
    });
    if (!inv) throw new NotFoundException('Invoice not found');
    if (inv.customer_id !== customerId) {
      throw new BadRequestException('Invoice does not belong to the selected customer');
    }
    return inv;
  }

  private processLineItems(raw: InputLineItem[]): { items: CalculatedLineItem[]; totals: CreditNoteTotals } {
    if (!raw.length) throw new BadRequestException('Credit note must have at least one line item');
    const items = raw.map((item, i) => calcLineItem(item, i));
    return { items, totals: calcTotals(items) };
  }

  private async generateCreditNoteNumber(
    tx: Parameters<Parameters<typeof this.prisma.client.$transaction>[0]>[0],
    companyId: string,
  ): Promise<string> {
    const company = await tx.company.findUnique({
      where: { id: companyId },
      select: { credit_note_prefix: true, credit_note_next_number: true },
    });
    if (!company) throw new NotFoundException('Company not found');

    const prefix = company.credit_note_prefix ?? 'CN';
    const num = company.credit_note_next_number ?? 1;
    const creditNoteNumber = `${prefix}-${String(num).padStart(3, '0')}`;

    await tx.company.update({
      where: { id: companyId },
      data: { credit_note_next_number: num + 1 },
    });

    return creditNoteNumber;
  }

  // ── List ───────────────────────────────────────────────────────────────────

  async list(companyId: string, filters?: { status?: string; customer_id?: string; search?: string }) {
    const where: Record<string, unknown> = { company_id: companyId };
    if (filters?.status) where.status = filters.status;
    if (filters?.customer_id) where.customer_id = filters.customer_id;
    if (filters?.search) {
      where.OR = [
        { credit_note_number: { contains: filters.search, mode: 'insensitive' } },
        { customer: { name: { contains: filters.search, mode: 'insensitive' } } },
      ];
    }

    return this.prisma.client.creditNote.findMany({
      where,
      include: CREDIT_NOTE_INCLUDE,
      orderBy: { created_at: 'desc' },
    });
  }

  // ── Get one ────────────────────────────────────────────────────────────────

  async getOne(companyId: string, id: string) {
    const note = await this.prisma.client.creditNote.findFirst({
      where: { id, company_id: companyId },
      include: CREDIT_NOTE_INCLUDE,
    });
    if (!note) throw new NotFoundException('Credit note not found');
    return note;
  }

  // ── Create ─────────────────────────────────────────────────────────────────

  async create(companyId: string, dto: CreateCreditNoteDto) {
    await this.verifyCustomer(dto.customer_id, companyId);
    if (dto.invoice_id) await this.verifyInvoice(dto.invoice_id, companyId, dto.customer_id);

    const { items, totals } = this.processLineItems(dto.line_items);

    return this.prisma.client.$transaction(async (tx) => {
      const creditNoteNumber = await this.generateCreditNoteNumber(tx, companyId);

      return tx.creditNote.create({
        data: {
          company_id:         companyId,
          customer_id:        dto.customer_id,
          invoice_id:         dto.invoice_id,
          credit_note_number: creditNoteNumber,
          reason:             dto.reason,
          line_items:         items as never,
          subtotal_pence:     totals.subtotal_pence,
          vat_amount_pence:   totals.vat_amount_pence,
          total_pence:        totals.total_pence,
          date:               dto.date ? new Date(dto.date) : new Date(),
          notes:              dto.notes,
        },
        include: CREDIT_NOTE_INCLUDE,
      });
    });
  }

  // ── Update (draft only) ───────────────────────────────────────────────────

  async update(companyId: string, id: string, dto: UpdateCreditNoteDto) {
    const note = await this.getOne(companyId, id);
    if (note.status !== 'DRAFT') {
      throw new BadRequestException('Only draft credit notes can be edited');
    }

    const customerId = dto.customer_id ?? note.customer_id;
    if (dto.customer_id) await this.verifyCustomer(dto.customer_id, companyId);

    const invoiceId = dto.invoice_id !== undefined ? dto.invoice_id : note.invoice_id;
    if (invoiceId) await this.verifyInvoice(invoiceId, companyId, customerId);

    const rawItems = dto.line_items ?? (note.line_items as unknown as InputLineItem[]);
    const { items, totals } = this.processLineItems(rawItems);

    return this.prisma.client.creditNote.update({
      where: { id },
      data: {
        customer_id:      customerId,
        invoice_id:       invoiceId,
        reason:           dto.reason !== undefined ? dto.reason : note.reason,
        line_items:       items as never,
        subtotal_pence:   totals.subtotal_pence,
        vat_amount_pence: totals.vat_amount_pence,
        total_pence:      totals.total_pence,
        date:             dto.date ? new Date(dto.date) : note.date,
        notes:            dto.notes !== undefined ? dto.notes : note.notes,
      },
      include: CREDIT_NOTE_INCLUDE,
    });
  }

  // ── Issue (DRAFT → ISSUED) ─────────────────────────────────────────────────

  async issue(companyId: string, id: string) {
    const note = await this.getOne(companyId, id);
    if (note.status !== 'DRAFT') {
      throw new BadRequestException('Only draft credit notes can be issued');
    }

    return this.prisma.client.$transaction(async (tx) => {
      const issued = await tx.creditNote.update({
        where: { id },
        data: { status: 'ISSUED', issued_at: new Date() },
        include: CREDIT_NOTE_INCLUDE,
      });

      if (note.invoice_id) {
        const invoice = await tx.invoice.findUnique({ where: { id: note.invoice_id } });
        if (invoice) {
          const newDue = Math.max(0, invoice.amount_due_pence - note.total_pence);
          // A credit note can bring the balance to zero without any money
          // changing hands — that's still functionally "nothing left to
          // collect", so we fold it into the same PAID state the rest of
          // the invoice flow uses for a zero balance (see addPayment/markPaid
          // in InvoicesService). It only applies to invoices that were
          // actually outstanding — drafts/cancelled invoices are untouched.
          const shouldMarkPaid = newDue === 0 && ['SENT', 'PART_PAID', 'OVERDUE'].includes(invoice.status);

          await tx.invoice.update({
            where: { id: note.invoice_id },
            data: {
              amount_due_pence: newDue,
              ...(shouldMarkPaid ? { status: 'PAID' as never } : {}),
            },
          });
        }
      }

      return issued;
    });
  }

  // ── Void (ISSUED → VOID) ───────────────────────────────────────────────────

  async void(companyId: string, id: string) {
    const note = await this.getOne(companyId, id);
    if (note.status !== 'ISSUED') {
      throw new BadRequestException('Only issued credit notes can be voided');
    }

    return this.prisma.client.$transaction(async (tx) => {
      const voided = await tx.creditNote.update({
        where: { id },
        data: { status: 'VOID', voided_at: new Date() },
        include: CREDIT_NOTE_INCLUDE,
      });

      if (note.invoice_id) {
        const invoice = await tx.invoice.findUnique({ where: { id: note.invoice_id } });
        if (invoice) {
          const restoredDue = Math.min(
            invoice.total_pence - invoice.amount_paid_pence,
            invoice.amount_due_pence + note.total_pence,
          );
          // If the credit note was what brought this invoice to PAID (with no
          // real payment behind it), reverting needs to put the status back
          // — mirrors InvoicesService.markUnpaid()'s same status fallback.
          const shouldRevertPaid = restoredDue > 0 && invoice.status === 'PAID';
          const revertedStatus = invoice.amount_paid_pence > 0 ? 'PART_PAID' : 'SENT';

          await tx.invoice.update({
            where: { id: note.invoice_id },
            data: {
              amount_due_pence: restoredDue,
              ...(shouldRevertPaid ? { status: revertedStatus as never } : {}),
            },
          });
        }
      }

      return voided;
    });
  }

  // ── Delete (draft only) ────────────────────────────────────────────────────

  async remove(companyId: string, id: string): Promise<void> {
    const note = await this.getOne(companyId, id);
    if (note.status !== 'DRAFT') {
      throw new ConflictException('Only draft credit notes can be deleted');
    }
    await this.prisma.client.creditNote.delete({ where: { id } });
  }

  // ── Generate PDF ───────────────────────────────────────────────────────────

  async generatePdf(companyId: string, id: string): Promise<Buffer> {
    const note = await this.getOne(companyId, id);
    const company = await this.prisma.client.company.findUnique({
      where: { id: companyId },
      omit: { stripe_customer_id: true, stripe_subscription_id: true },
    });
    if (!company) throw new NotFoundException('Company not found');

    const { buildCreditNoteHtml } = await import('./credit-notes.pdf.js');
    const html = buildCreditNoteHtml(note as never, company as never);

    const puppeteer = await import('puppeteer');
    const browser = await puppeteer.default.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });
    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'domcontentloaded' });
      const pdf = await page.pdf({ format: 'A4', printBackground: true, margin: { top: '20mm', bottom: '20mm', left: '15mm', right: '15mm' } });
      return Buffer.from(pdf);
    } finally {
      await browser.close();
    }
  }

  // ── Email credit note ──────────────────────────────────────────────────────

  async emailCreditNote(companyId: string, id: string) {
    const note = await this.getOne(companyId, id);
    const company = await this.prisma.client.company.findUnique({ where: { id: companyId } });
    if (!company) throw new NotFoundException('Company not found');

    if (!note.customer.email) {
      throw new BadRequestException('Customer email is required to send credit note');
    }

    const resendKey = process.env.RESEND_API_KEY;
    if (!resendKey) throw new BadRequestException('Email service is not configured');

    let pdfBuffer: Buffer | undefined;
    try {
      pdfBuffer = await this.generatePdf(companyId, id);
    } catch (err) {
      this.logger.warn(`PDF generation failed for credit note ${id}: ${String(err)}`);
    }

    const gbp = (pence: number) =>
      new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(pence / 100);

    const resend = new Resend(resendKey);
    const { error: emailError } = await resend.emails.send({
      from: process.env.FROM_EMAIL ?? 'noreply@vantro.co.uk',
      to: note.customer.email,
      subject: `Credit Note ${note.credit_note_number} from ${company.name}`,
      html: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;color:#111827;">
               <h2 style="font-size:20px;margin-bottom:4px;">Credit Note ${note.credit_note_number}</h2>
               <p style="color:#6b7280;font-size:14px;margin-top:0;">From <strong>${company.name}</strong></p>
               ${note.invoice ? `<p style="color:#6b7280;font-size:13px;">Against invoice <strong>${note.invoice.invoice_number}</strong></p>` : ''}
               <table style="width:100%;border-collapse:collapse;margin:16px 0;">
                 <tr><td style="padding:6px 0;font-size:14px;color:#6b7280;">Reason</td><td style="padding:6px 0;font-size:14px;text-align:right;">${note.reason}</td></tr>
                 <tr><td style="padding:6px 0;font-size:14px;color:#6b7280;">Credit amount</td><td style="padding:6px 0;font-size:14px;font-weight:700;text-align:right;">${gbp(note.total_pence)}</td></tr>
               </table>
               <p style="font-size:13px;color:#6b7280;">A PDF copy of this credit note is attached for your records.</p>
             </div>`,
      ...(pdfBuffer
        ? { attachments: [{ filename: `credit-note-${note.credit_note_number}.pdf`, content: pdfBuffer }] }
        : {}),
    });
    if (emailError) throw new Error(`Failed to send credit note email: ${emailError.message}`);

    this.logger.log(`Credit note ${note.credit_note_number} emailed to ${note.customer.email}`);

    void this.comms.log({
      company_id:  companyId,
      customer_id: note.customer_id,
      invoice_id:  note.invoice_id ?? undefined,
      type:        'CREDIT_NOTE_SENT',
      subject:     `Credit Note ${note.credit_note_number}`,
      to_email:    note.customer.email,
      reference:   note.credit_note_number,
    });

    return { sent: true };
  }
}
