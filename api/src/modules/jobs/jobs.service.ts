import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateJobDto } from './dto/create-job.dto';
import { UpdateJobDto } from './dto/update-job.dto';
import { RecurringJobsService } from '../recurring-jobs/recurring-jobs.service';
import { JobNotificationsService } from './job-notifications.service';

const JOB_INCLUDE = {
  customer: { select: { id: true, name: true, email: true, phone: true } },
  engineer: { select: { id: true, name: true, email: true } },
  _count: { select: { photos: true, gasCertificates: true } },
} as const;

@Injectable()
export class JobsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly recurringJobsService: RecurringJobsService,
    private readonly jobNotificationsService: JobNotificationsService,
  ) {}

  async create(dto: CreateJobDto, companyId: string) {
    await this.verifyCustomer(dto.customer_id, companyId);
    if (dto.engineer_id) await this.verifyEngineer(dto.engineer_id, companyId);

    return this.prisma.client.job.create({
      data: { ...dto, company_id: companyId },
      include: JOB_INCLUDE,
    });
  }

  findAll(companyId: string, callerId: string, isOwner: boolean) {
    const where = isOwner
      ? { company_id: companyId }
      : { company_id: companyId, engineer_id: callerId };

    return this.prisma.client.job.findMany({
      where,
      include: JOB_INCLUDE,
      orderBy: { created_at: 'desc' },
    });
  }

  async findOne(
    id: string,
    companyId: string,
    callerId: string,
    isOwner: boolean,
  ) {
    const where = isOwner
      ? { id, company_id: companyId }
      : { id, company_id: companyId, engineer_id: callerId };

    const job = await this.prisma.client.job.findFirst({
      where,
      include: {
        customer: true,
        engineer: { select: { id: true, name: true, email: true, calendar_colour: true } },
        invoices: {
          include: { payments: true },
          orderBy: { created_at: 'desc' },
        },
        quotes: {
          include: { invoices: { select: { id: true, status: true } } },
          orderBy: { created_at: 'desc' },
        },
        timesheets: {
          include: { user: { select: { id: true, name: true } } },
          orderBy: { date: 'desc' },
        },
        gasCertificates: {
          orderBy: { created_at: 'desc' },
        },
      },
    });
    if (!job) throw new NotFoundException('Job not found');
    return job;
  }

  async update(id: string, dto: UpdateJobDto, companyId: string) {
    const existing = await this.prisma.client.job.findFirst({
      where: { id, company_id: companyId },
    });
    if (!existing) throw new NotFoundException('Job not found');

    if (dto.customer_id) await this.verifyCustomer(dto.customer_id, companyId);
    if (dto.engineer_id) await this.verifyEngineer(dto.engineer_id, companyId);

    const updated = await this.prisma.client.job.update({
      where: { id },
      data: dto,
      include: JOB_INCLUDE,
    });

    if (dto.status === 'COMPLETED') {
      void this.recurringJobsService.handleJobCompleted(id);
    }

    if (dto.engineer_id && dto.engineer_id !== existing.engineer_id) {
      void this.jobNotificationsService.sendJobAssignedEmail(updated.id);
    }

    return updated;
  }

  findScheduled(
    companyId: string,
    userId: string,
    isOwner: boolean,
    start: string,
    end: string,
  ) {
    if (!start || !end) {
      throw new BadRequestException('start and end query parameters are required');
    }
    const startDate = new Date(start);
    const endDate = new Date(end);
    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      throw new BadRequestException('start and end must be valid ISO date strings');
    }

    const where = {
      company_id: companyId,
      scheduled_at: { gte: startDate, lte: endDate },
      ...(!isOwner ? { engineer_id: userId } : {}),
    };

    return this.prisma.client.job.findMany({
      where,
      select: {
        id: true,
        title: true,
        status: true,
        scheduled_at: true,
        duration_minutes: true,
        schedule_note: true,
        customer: {
          select: {
            name: true,
            phone: true,
            address_line1: true,
            address_line2: true,
            city: true,
            postcode: true,
          },
        },
        engineer: { select: { id: true, name: true, calendar_colour: true } },
      },
      orderBy: { scheduled_at: 'asc' },
    });
  }

  async remove(id: string, companyId: string) {
    const existing = await this.prisma.client.job.findFirst({
      where: { id, company_id: companyId },
    });
    if (!existing) throw new NotFoundException('Job not found');

    try {
      await this.prisma.client.job.delete({ where: { id } });
    } catch (err: unknown) {
      if (isPrismaFkError(err)) {
        throw new ConflictException('Cannot delete a job with related records');
      }
      throw err;
    }
  }

  private async verifyCustomer(customerId: string, companyId: string) {
    const customer = await this.prisma.client.customer.findFirst({
      where: { id: customerId, company_id: companyId },
    });
    if (!customer) throw new NotFoundException('Customer not found');
  }

  private async verifyEngineer(engineerId: string, companyId: string) {
    const engineer = await this.prisma.client.user.findFirst({
      where: { id: engineerId, companyId },
    });
    if (!engineer) throw new NotFoundException('Engineer not found');
  }
}

function isPrismaFkError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: string }).code === 'P2003'
  );
}
