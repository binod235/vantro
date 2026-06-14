import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

const STAGE_INCLUDE = {
  invoice: {
    select: {
      id:             true,
      invoice_number: true,
      status:         true,
      total_pence:    true,
    },
  },
} as const;

@Injectable()
export class JobStagesService {
  constructor(private readonly prisma: PrismaService) {}

  // ── List ───────────────────────────────────────────────────────────────────

  async list(companyId: string, jobId: string) {
    const job = await this.prisma.client.job.findFirst({
      where: { id: jobId, company_id: companyId },
    });
    if (!job) throw new NotFoundException('Job not found');

    return this.prisma.client.jobStage.findMany({
      where:   { job_id: jobId, company_id: companyId },
      include: STAGE_INCLUDE,
      orderBy: { order_index: 'asc' },
    });
  }

  // ── Create ─────────────────────────────────────────────────────────────────

  async create(companyId: string, jobId: string, dto: {
    name:          string;
    amount_type:   'PERCENTAGE' | 'FIXED';
    percentage?:   number;
    amount_pence?: number;
    order_index?:  number;
  }) {
    const job = await this.prisma.client.job.findFirst({
      where: { id: jobId, company_id: companyId },
    });
    if (!job) throw new NotFoundException('Job not found');

    if (dto.amount_type === 'PERCENTAGE' && !dto.percentage) {
      throw new BadRequestException('Percentage is required');
    }
    if (dto.amount_type === 'FIXED' && !dto.amount_pence) {
      throw new BadRequestException('Amount is required');
    }

    const lastStage = await this.prisma.client.jobStage.findFirst({
      where:   { job_id: jobId },
      orderBy: { order_index: 'desc' },
      select:  { order_index: true },
    });
    const orderIndex = dto.order_index ?? (lastStage?.order_index ?? 0) + 1;

    return this.prisma.client.jobStage.create({
      data: {
        company_id:   companyId,
        job_id:       jobId,
        name:         dto.name,
        order_index:  orderIndex,
        amount_type:  dto.amount_type,
        percentage:   dto.percentage   ?? null,
        amount_pence: dto.amount_pence ?? null,
        status:       'PENDING',
      },
      include: STAGE_INCLUDE,
    });
  }

  // ── Update ─────────────────────────────────────────────────────────────────

  async update(companyId: string, stageId: string, dto: {
    name?:         string;
    amount_type?:  string;
    percentage?:   number;
    amount_pence?: number;
    order_index?:  number;
  }) {
    const stage = await this.prisma.client.jobStage.findFirst({
      where: { id: stageId, company_id: companyId },
    });
    if (!stage) throw new NotFoundException('Stage not found');
    if (stage.status !== 'PENDING') {
      throw new BadRequestException('Cannot edit an invoiced stage');
    }

    return this.prisma.client.jobStage.update({
      where:   { id: stageId },
      data:    dto as never,
      include: STAGE_INCLUDE,
    });
  }

  // ── Delete ─────────────────────────────────────────────────────────────────

  async remove(companyId: string, stageId: string): Promise<void> {
    const stage = await this.prisma.client.jobStage.findFirst({
      where: { id: stageId, company_id: companyId },
    });
    if (!stage) throw new NotFoundException('Stage not found');
    if (stage.status !== 'PENDING') {
      throw new BadRequestException('Cannot delete an invoiced stage');
    }
    await this.prisma.client.jobStage.delete({ where: { id: stageId } });
  }

  // ── Create invoice from stage ──────────────────────────────────────────────

  async createInvoiceFromStage(companyId: string, stageId: string) {
    const stage = await this.prisma.client.jobStage.findFirst({
      where:   { id: stageId, company_id: companyId },
      include: {
        job: {
          include: {
            customer: true,
            quotes: {
              where:   { status: 'ACCEPTED' },
              orderBy: { created_at: 'desc' },
              take:    1,
            },
          },
        },
      },
    });

    if (!stage) throw new NotFoundException('Stage not found');
    if (stage.status !== 'PENDING') {
      throw new BadRequestException('Invoice already created for this stage');
    }
    if (!stage.job.customer_id) {
      throw new BadRequestException('Job has no customer');
    }

    // Calculate net amount for the stage (VAT will be added on top)
    let stagePence = 0;
    if (stage.amount_type === 'FIXED') {
      stagePence = stage.amount_pence ?? 0;
    } else {
      const acceptedQuote = stage.job.quotes[0];
      const basePence     = acceptedQuote?.total_pence ?? 0;
      stagePence = Math.round(basePence * ((stage.percentage ?? 0) / 100));
    }

    if (stagePence <= 0) {
      throw new BadRequestException(
        'Stage amount is zero. For percentage stages, the job needs an accepted quote.',
      );
    }

    const company = await this.prisma.client.company.findUnique({
      where:  { id: companyId },
      select: {
        invoice_prefix:      true,
        invoice_next_number: true,
      },
    });
    if (!company) throw new NotFoundException('Company not found');

    return this.prisma.client.$transaction(async (tx) => {
      const prefix     = company.invoice_prefix ?? 'INV';
      const num        = company.invoice_next_number ?? 1;
      const invoiceNum = `${prefix}-${String(num).padStart(3, '0')}`;

      await tx.company.update({
        where: { id: companyId },
        data:  { invoice_next_number: { increment: 1 } },
      });

      const issueDate = new Date();
      const dueDate   = new Date(issueDate);
      dueDate.setDate(dueDate.getDate() + 30);

      const vatAmount  = Math.round(stagePence * 0.20);
      const totalPence = stagePence + vatAmount;

      const lineItem = {
        id:                       `stage_${stageId}`,
        description:              stage.name,
        quantity:                 1,
        unit_price_pence:         stagePence,
        vat_type:                 'STANDARD',
        vat_rate:                 20,
        net_pence:                stagePence,
        vat_pence:                vatAmount,
        reverse_charge_vat_pence: 0,
      };

      const invoice = await tx.invoice.create({
        data: {
          company_id:               companyId,
          customer_id:              stage.job.customer_id!,
          job_id:                   stage.job.id,
          invoice_number:           invoiceNum,
          invoice_type:             'PROGRESS' as never,
          source_type:              'MANUAL'   as never,
          line_items:               [lineItem] as never,
          subtotal_pence:           stagePence,
          vat_amount_pence:         vatAmount,
          reverse_charge_vat_pence: 0,
          total_pence:              totalPence,
          amount_due_pence:         totalPence,
          is_reverse_charge:        false,
          issue_date:               issueDate,
          due_date:                 dueDate,
        },
      });

      await tx.jobStage.update({
        where: { id: stageId },
        data: {
          status:     'INVOICED',
          invoice_id: invoice.id,
        },
      });

      return invoice;
    });
  }
}
