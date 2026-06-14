import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export interface LogEmailParams {
  company_id:   string;
  customer_id?: string;
  job_id?:      string;
  invoice_id?:  string;
  quote_id?:    string;
  type:         string;
  subject:      string;
  to_email:     string;
  reference?:   string;
  status?:      'SENT' | 'FAILED';
  notes?:       string;
}

@Injectable()
export class CommsService {
  private readonly logger = new Logger(CommsService.name);

  constructor(private readonly prisma: PrismaService) {}

  // Fire and forget — never throw, never block
  async log(params: LogEmailParams): Promise<void> {
    try {
      await this.prisma.client.communicationLog.create({
        data: {
          company_id:  params.company_id,
          customer_id: params.customer_id ?? null,
          job_id:      params.job_id      ?? null,
          invoice_id:  params.invoice_id  ?? null,
          quote_id:    params.quote_id    ?? null,
          type:        params.type,
          subject:     params.subject,
          to_email:    params.to_email,
          reference:   params.reference   ?? null,
          status:      params.status      ?? 'SENT',
          notes:       params.notes       ?? null,
        },
      });
    } catch (err) {
      this.logger.warn(`Failed to log communication: ${String(err)}`);
    }
  }

  async listByCustomer(companyId: string, customerId: string) {
    return this.prisma.client.communicationLog.findMany({
      where:   { company_id: companyId, customer_id: customerId },
      orderBy: { sent_at: 'desc' },
      take:    100,
    });
  }

  async listByJob(companyId: string, jobId: string) {
    return this.prisma.client.communicationLog.findMany({
      where:   { company_id: companyId, job_id: jobId },
      orderBy: { sent_at: 'desc' },
    });
  }

  async listByCompany(
    companyId: string,
    filters?: { customer_id?: string; type?: string },
  ) {
    const where: Record<string, unknown> = { company_id: companyId };
    if (filters?.customer_id) where.customer_id = filters.customer_id;
    if (filters?.type)        where.type         = filters.type;
    return this.prisma.client.communicationLog.findMany({
      where,
      include: {
        customer: { select: { id: true, name: true } },
      },
      orderBy: { sent_at: 'desc' },
      take:    200,
    });
  }
}
