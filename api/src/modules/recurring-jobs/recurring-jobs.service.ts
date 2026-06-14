import {
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import type { CreateRecurringJobDto } from './dto/create-recurring-job.dto';
import type { UpdateRecurringJobDto } from './dto/update-recurring-job.dto';
import { JobNotificationsService } from '../jobs/job-notifications.service';

const INCLUDE = {
  customer: { select: { id: true, name: true, email: true, phone: true } },
  engineer: { select: { id: true, name: true } },
  jobs: {
    select: { id: true, status: true, created_at: true },
    orderBy: { created_at: 'desc' as const },
    take: 5,
  },
} as const;

@Injectable()
export class RecurringJobsService {
  private readonly logger = new Logger(RecurringJobsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jobNotificationsService: JobNotificationsService,
  ) {}

  // ── List ──────────────────────────────────────────────────────────────────

  async list(companyId: string) {
    return this.prisma.client.recurringJob.findMany({
      where:   { company_id: companyId },
      include: INCLUDE,
      orderBy: { created_at: 'desc' },
    });
  }

  // ── Get one ───────────────────────────────────────────────────────────────

  async getOne(companyId: string, id: string) {
    const rj = await this.prisma.client.recurringJob.findFirst({
      where:   { id, company_id: companyId },
      include: INCLUDE,
    });
    if (!rj) throw new NotFoundException('Recurring job not found');
    return rj;
  }

  // ── Create ────────────────────────────────────────────────────────────────

  async create(companyId: string, dto: CreateRecurringJobDto) {
    const customer = await this.prisma.client.customer.findFirst({
      where: { id: dto.customer_id, company_id: companyId },
    });
    if (!customer) throw new NotFoundException('Customer not found');

    let nextRunDate: Date | null = null;
    if (dto.trigger_type === 'CALENDAR' && dto.start_date) {
      nextRunDate = new Date(dto.start_date);
    }

    return this.prisma.client.recurringJob.create({
      data: {
        company_id:       companyId,
        customer_id:      dto.customer_id,
        engineer_id:      dto.engineer_id ?? null,
        title:            dto.title,
        description:      dto.description ?? null,
        schedule_note:    dto.schedule_note ?? null,
        duration_minutes: dto.duration_minutes ?? null,
        frequency_type:   dto.frequency_type,
        frequency_value:  dto.frequency_value,
        trigger_type:     dto.trigger_type,
        assign_type:      dto.assign_type ?? 'MANUAL',
        creation_mode:    dto.creation_mode ?? 'ASSIGN',
        scheduled_time:   dto.scheduled_time ?? null,
        next_run_date:    nextRunDate,
        is_active:        true,
      },
      include: INCLUDE,
    });
  }

  // ── Update ────────────────────────────────────────────────────────────────

  async update(companyId: string, id: string, dto: UpdateRecurringJobDto) {
    await this.getOne(companyId, id);

    const data: Record<string, unknown> = { ...dto };

    if (data.next_run_date && typeof data.next_run_date === 'string') {
      data.next_run_date = new Date(data.next_run_date as string);
    }

    Object.keys(data).forEach(key => {
      if (data[key] === undefined) delete data[key];
    });

    return this.prisma.client.recurringJob.update({
      where:   { id },
      data:    data as never,
      include: INCLUDE,
    });
  }

  // ── Pause / Resume ────────────────────────────────────────────────────────

  async toggleActive(companyId: string, id: string) {
    const rj = await this.getOne(companyId, id);
    return this.prisma.client.recurringJob.update({
      where:   { id },
      data:    { is_active: !rj.is_active },
      include: INCLUDE,
    });
  }

  // ── Delete ────────────────────────────────────────────────────────────────

  async remove(companyId: string, id: string): Promise<void> {
    await this.getOne(companyId, id);
    await this.prisma.client.job.updateMany({
      where: { recurring_job_id: id },
      data:  { recurring_job_id: null },
    });
    await this.prisma.client.recurringJob.delete({ where: { id } });
  }

  // ── Create job from template (shared helper) ──────────────────────────────

  private async createJobFromTemplate(rj: {
    id: string;
    company_id: string;
    customer_id: string;
    engineer_id: string | null;
    title: string;
    description: string | null;
    schedule_note: string | null;
    duration_minutes: number | null;
    assign_type: string;
    creation_mode: string;
    scheduled_time: string | null;
    frequency_type: string;
    frequency_value: number;
    next_run_date: Date | null;
    trigger_type: string;
  }) {
    let engineerId:  string | null = null;
    let scheduledAt: Date | null   = null;
    let jobStatus:   string        = 'QUOTED';

    if (rj.creation_mode === 'SCHEDULE') {
      engineerId = rj.assign_type === 'SAME_ENGINEER' ? rj.engineer_id : null;
      const baseDate = rj.trigger_type === 'CALENDAR' && rj.next_run_date
        ? new Date(rj.next_run_date)
        : new Date();
      scheduledAt = new Date(baseDate);
      if (rj.scheduled_time) {
        const [hours, minutes] = rj.scheduled_time.split(':').map(Number);
        scheduledAt.setHours(hours ?? 9, minutes ?? 0, 0, 0);
      }
      jobStatus = 'SCHEDULED';
    } else if (rj.creation_mode === 'ASSIGN') {
      engineerId = rj.assign_type === 'SAME_ENGINEER' ? rj.engineer_id : null;
      scheduledAt = null;
      jobStatus   = 'SCHEDULED';
    } else {
      // CREATE_ONLY
      engineerId  = null;
      scheduledAt = null;
      jobStatus   = 'QUOTED';
    }

    const nextDate = this.calcNextDate(
      rj.next_run_date ?? new Date(),
      rj.frequency_type,
      rj.frequency_value,
    );

    let createdJobId: string | null = null;

    await this.prisma.client.$transaction(async (tx) => {
      const createdJob = await tx.job.create({
        data: {
          company_id:       rj.company_id,
          customer_id:      rj.customer_id,
          engineer_id:      engineerId,
          title:            rj.title,
          description:      rj.description,
          schedule_note:    rj.schedule_note,
          duration_minutes: rj.duration_minutes,
          status:           jobStatus as never,
          scheduled_at:     scheduledAt,
          recurring_job_id: rj.id,
        },
      });
      createdJobId = createdJob.id;

      await tx.recurringJob.update({
        where: { id: rj.id },
        data: {
          last_run_at:   new Date(),
          jobs_created:  { increment: 1 },
          next_run_date: nextDate,
        },
      });
    });

    if (engineerId && createdJobId) {
      void this.jobNotificationsService.sendJobAssignedEmail(createdJobId);
    }

    this.logger.log(
      `Created job (mode: ${rj.creation_mode}) from template "${rj.title}" (id: ${rj.id})`,
    );
  }

  private calcNextDate(
    from: Date,
    frequencyType: string,
    frequencyValue: number,
  ): Date {
    const next = new Date(from);
    switch (frequencyType) {
      case 'DAYS':
        next.setDate(next.getDate() + frequencyValue);
        break;
      case 'WEEKS':
        next.setDate(next.getDate() + frequencyValue * 7);
        break;
      case 'MONTHS':
        next.setMonth(next.getMonth() + frequencyValue);
        break;
    }
    return next;
  }

  // ── Cron: daily at 07:00 — CALENDAR-triggered jobs ───────────────────────

  @Cron('0 7 * * *')
  async runCalendarTrigger() {
    this.logger.log('Running recurring jobs calendar trigger...');
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const due = await this.prisma.client.recurringJob.findMany({
      where: {
        is_active:     true,
        trigger_type:  'CALENDAR',
        next_run_date: { gte: today, lt: tomorrow },
      },
    });

    this.logger.log(`Found ${due.length} recurring job(s) due today`);

    for (const rj of due) {
      try {
        await this.createJobFromTemplate(rj);
      } catch (err) {
        this.logger.error(
          `Failed to create job from template ${rj.id}: ${String(err)}`,
        );
      }
    }
  }

  // ── ON_COMPLETION trigger ─────────────────────────────────────────────────

  async handleJobCompleted(jobId: string) {
    const job = await this.prisma.client.job.findUnique({
      where:  { id: jobId },
      select: { recurring_job_id: true },
    });
    if (!job?.recurring_job_id) return;

    const rj = await this.prisma.client.recurringJob.findUnique({
      where: { id: job.recurring_job_id },
    });
    if (!rj || !rj.is_active || rj.trigger_type !== 'ON_COMPLETION') return;

    try {
      await this.createJobFromTemplate(rj);
      this.logger.log(`ON_COMPLETION: created next job from template ${rj.id}`);
    } catch (err) {
      this.logger.error(
        `ON_COMPLETION trigger failed for template ${rj.id}: ${String(err)}`,
      );
    }
  }

  // ── Manual trigger ────────────────────────────────────────────────────────

  async triggerNow(companyId: string, id: string) {
    const rj = await this.getOne(companyId, id);
    await this.createJobFromTemplate(rj);
    return { triggered: true };
  }
}
