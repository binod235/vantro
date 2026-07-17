import { Injectable, Logger } from '@nestjs/common';
import { Resend } from 'resend';
import { PrismaService } from '../../prisma/prisma.service';
import { CommsService } from '../comms/comms.service';
import { reviewRequestHtml } from './templates/review-request.email';

@Injectable()
export class ReviewRequestService {
  private readonly logger = new Logger(ReviewRequestService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly comms: CommsService,
  ) {}

  /**
   * Called fire-and-forget from invoices.service.ts markPaid().
   * Silently skips if review requests are disabled, URL is missing,
   * or the request has already been sent for this invoice.
   */
  async sendAfterPayment(invoiceId: string, companyId: string): Promise<void> {
    try {
      const [company, invoice] = await Promise.all([
        this.prisma.client.company.findUnique({
          where: { id: companyId },
          select: {
            id: true,
            name: true,
            logo_url: true,
            branding_footer_enabled: true,
            review_requests_enabled: true,
            google_review_url: true,
          },
        }),
        this.prisma.client.invoice.findUnique({
          where: { id: invoiceId },
          select: {
            id: true,
            invoice_number: true,
            review_request_sent: true,
            customer: { select: { id: true, name: true, email: true } },
          },
        }),
      ]);

      if (!company?.review_requests_enabled) return;
      if (!company.google_review_url) return;
      if (!invoice) return;
      if (invoice.review_request_sent) return;
      if (!invoice.customer?.email) return;

      const owner = await this.prisma.client.user.findFirst({
        where: { companyId: company.id, role: 'OWNER' },
        select: { email: true },
      });
      const companyEmail = owner?.email ?? (process.env.FROM_EMAIL ?? 'noreply@vantro.co.uk');

      const subject = `Thank you — ${company.name}`;
      const html = reviewRequestHtml({
        customerName: invoice.customer.name,
        companyName: company.name,
        companyEmail,
        invoiceNumber: invoice.invoice_number,
        reviewUrl: company.google_review_url,
        logoUrl: company.logo_url,
        brandingFooterEnabled: company.branding_footer_enabled,
      });

      const resendKey = process.env.RESEND_API_KEY;
      if (!resendKey) return;

      const resend = new Resend(resendKey);
      const { error } = await resend.emails.send({
        from: process.env.FROM_EMAIL ?? 'noreply@vantro.co.uk',
        to: invoice.customer.email,
        replyTo: companyEmail,
        subject,
        html,
      });

      if (error) {
        this.logger.warn(`Review request email failed for invoice ${invoice.invoice_number}: ${error.message}`);
        return;
      }

      await this.prisma.client.invoice.update({
        where: { id: invoiceId },
        data: {
          review_request_sent: true,
          review_request_sent_at: new Date(),
        },
      });

      void this.prisma.client.autopilotEvent.create({
        data: {
          company_id: companyId,
          type: 'REVIEW_REQUESTED',
          title: `Review request sent to ${invoice.customer.name} after payment of ${invoice.invoice_number}`,
          meta: { invoiceId, invoiceNumber: invoice.invoice_number },
        },
      }).catch(() => {});

      void this.comms.log({
        company_id: companyId,
        customer_id: invoice.customer.id,
        invoice_id: invoiceId,
        type: 'REVIEW_REQUEST',
        subject,
        to_email: invoice.customer.email,
        reference: invoice.invoice_number,
        notes: 'Auto review request after payment',
      });
    } catch (err) {
      this.logger.error(`ReviewRequestService.sendAfterPayment failed: ${String(err)}`);
    }
  }
}
