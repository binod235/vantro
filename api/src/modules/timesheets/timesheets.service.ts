import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { BillingRate } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateTimesheetDto } from './create-timesheet.dto';
import { UpdateTimesheetDto } from './update-timesheet.dto';
import { FilterTimesheetDto } from './filter-timesheet.dto';

const TIMESHEET_INCLUDE = {
  user: { select: { id: true, name: true, email: true } },
  job: { select: { id: true, title: true } },
  approved_by: { select: { id: true, name: true } },
} as const;

@Injectable()
export class TimesheetsService {
  constructor(private readonly prisma: PrismaService) {}

  private async verifyJob(jobId: string, companyId: string) {
    const job = await this.prisma.client.job.findFirst({
      where: { id: jobId, company_id: companyId },
    });
    if (!job) throw new NotFoundException('Job not found');
  }

  async create(
    companyId: string,
    requestingUserId: string,
    requestingRole: string,
    dto: CreateTimesheetDto,
  ) {
    if (dto.job_id) await this.verifyJob(dto.job_id, companyId);

    const userId =
      requestingRole === 'OWNER' ? (dto.user_id ?? requestingUserId) : requestingUserId;

    const startMs = dto.start_time.getTime();
    const finishMs = dto.finish_time.getTime();
    if (finishMs <= startMs) {
      throw new BadRequestException('finish_time must be after start_time');
    }

    const rawMinutes = Math.round((finishMs - startMs) / 60000);
    const breakMinutes = dto.break_minutes ?? 0;
    const durationMinutes = rawMinutes - breakMinutes;
    if (durationMinutes <= 0) {
      throw new BadRequestException('Duration after break must be greater than 0');
    }

    let hourlyRatePence = dto.hourly_rate_pence;
    if (hourlyRatePence === undefined || hourlyRatePence === null) {
      hourlyRatePence = await this.resolveRate(companyId, dto.billing_rate ?? 'STANDARD');
    }

    const totalPence = Math.round((durationMinutes / 60) * hourlyRatePence);

    return this.prisma.client.timesheet.create({
      data: {
        company_id: companyId,
        user_id: userId,
        job_id: dto.job_id ?? null,
        date: dto.date,
        start_time: dto.start_time,
        finish_time: dto.finish_time,
        break_minutes: breakMinutes,
        duration_minutes: durationMinutes,
        billing_rate: dto.billing_rate ?? 'STANDARD',
        hourly_rate_pence: hourlyRatePence,
        total_pence: totalPence,
        notes: dto.notes ?? null,
      },
      include: TIMESHEET_INCLUDE,
    });
  }

  findAll(
    companyId: string,
    requestingUserId: string,
    role: string,
    filters: FilterTimesheetDto,
  ) {
    type DateFilter = { gte?: Date; lte?: Date };
    const where: {
      company_id: string;
      user_id?: string;
      job_id?: string;
      is_approved?: boolean;
      billing_rate?: BillingRate;
      date?: DateFilter;
    } = { company_id: companyId };

    if (role !== 'OWNER') {
      where.user_id = requestingUserId;
    } else if (filters.user_id) {
      where.user_id = filters.user_id;
    }

    if (filters.job_id) where.job_id = filters.job_id;
    if (filters.is_approved !== undefined) where.is_approved = filters.is_approved;
    if (filters.billing_rate) where.billing_rate = filters.billing_rate;
    if (filters.start_date ?? filters.end_date) {
      const dateFilter: DateFilter = {};
      if (filters.start_date) dateFilter.gte = filters.start_date;
      if (filters.end_date) dateFilter.lte = filters.end_date;
      where.date = dateFilter;
    }

    return this.prisma.client.timesheet.findMany({
      where,
      include: TIMESHEET_INCLUDE,
      orderBy: [{ date: 'desc' }, { start_time: 'desc' }],
    });
  }

  async findOne(
    companyId: string,
    requestingUserId: string,
    role: string,
    id: string,
  ) {
    const where =
      role === 'OWNER'
        ? { id, company_id: companyId }
        : { id, company_id: companyId, user_id: requestingUserId };

    const ts = await this.prisma.client.timesheet.findFirst({
      where,
      include: TIMESHEET_INCLUDE,
    });
    if (!ts) throw new NotFoundException('Timesheet not found');
    return ts;
  }

  async update(
    companyId: string,
    requestingUserId: string,
    role: string,
    id: string,
    dto: UpdateTimesheetDto,
  ) {
    const ts = await this.findOne(companyId, requestingUserId, role, id);
    if (ts.is_approved) {
      throw new ForbiddenException('Cannot edit an approved timesheet');
    }
    if (dto.job_id) await this.verifyJob(dto.job_id, companyId);

    const startTime = dto.start_time ?? ts.start_time;
    const finishTime = dto.finish_time ?? ts.finish_time;
    const startMs = startTime.getTime();
    const finishMs = finishTime.getTime();
    if (finishMs <= startMs) {
      throw new BadRequestException('finish_time must be after start_time');
    }

    const rawMinutes = Math.round((finishMs - startMs) / 60000);
    const breakMinutes = dto.break_minutes ?? ts.break_minutes;
    const durationMinutes = rawMinutes - breakMinutes;
    if (durationMinutes <= 0) {
      throw new BadRequestException('Duration after break must be greater than 0');
    }

    const hourlyRatePence = dto.hourly_rate_pence ?? ts.hourly_rate_pence;
    const totalPence = Math.round((durationMinutes / 60) * hourlyRatePence);

    return this.prisma.client.timesheet.update({
      where: { id },
      data: {
        user_id:
          role === 'OWNER' ? (dto.user_id ?? ts.user_id) : ts.user_id,
        job_id: dto.job_id !== undefined ? dto.job_id : ts.job_id,
        date: dto.date ?? ts.date,
        start_time: startTime,
        finish_time: finishTime,
        break_minutes: breakMinutes,
        duration_minutes: durationMinutes,
        billing_rate: dto.billing_rate ?? ts.billing_rate,
        hourly_rate_pence: hourlyRatePence,
        total_pence: totalPence,
        notes: dto.notes !== undefined ? dto.notes : ts.notes,
      },
      include: TIMESHEET_INCLUDE,
    });
  }

  async approve(companyId: string, approverId: string, id: string) {
    const ts = await this.prisma.client.timesheet.findFirst({
      where: { id, company_id: companyId },
    });
    if (!ts) throw new NotFoundException('Timesheet not found');
    return this.prisma.client.timesheet.update({
      where: { id },
      data: { is_approved: true, approved_by_id: approverId, approved_at: new Date() },
      include: TIMESHEET_INCLUDE,
    });
  }

  async unapprove(companyId: string, id: string) {
    const ts = await this.prisma.client.timesheet.findFirst({
      where: { id, company_id: companyId },
    });
    if (!ts) throw new NotFoundException('Timesheet not found');
    return this.prisma.client.timesheet.update({
      where: { id },
      data: { is_approved: false, approved_by_id: null, approved_at: null },
      include: TIMESHEET_INCLUDE,
    });
  }

  async remove(
    companyId: string,
    requestingUserId: string,
    role: string,
    id: string,
  ) {
    const ts = await this.findOne(companyId, requestingUserId, role, id);
    if (ts.is_approved) {
      throw new ForbiddenException('Cannot delete an approved timesheet');
    }
    await this.prisma.client.timesheet.delete({ where: { id } });
  }

  async getSummary(companyId: string, filters: FilterTimesheetDto) {
    const timesheets = await this.findAll(companyId, '', 'OWNER', filters);

    const byEngineer = new Map<
      string,
      { name: string; totalMinutes: number; totalPence: number }
    >();
    const byJob = new Map<string, { title: string; totalMinutes: number }>();

    for (const ts of timesheets) {
      const eng = byEngineer.get(ts.user_id) ?? {
        name: ts.user.name,
        totalMinutes: 0,
        totalPence: 0,
      };
      eng.totalMinutes += ts.duration_minutes;
      eng.totalPence += ts.total_pence;
      byEngineer.set(ts.user_id, eng);

      if (ts.job_id && ts.job) {
        const job = byJob.get(ts.job_id) ?? { title: ts.job.title, totalMinutes: 0 };
        job.totalMinutes += ts.duration_minutes;
        byJob.set(ts.job_id, job);
      }
    }

    return {
      byEngineer: Array.from(byEngineer.entries()).map(([id, d]) => ({ id, ...d })),
      byJob: Array.from(byJob.entries()).map(([id, d]) => ({ id, ...d })),
      totalMinutes: timesheets.reduce((s, t) => s + t.duration_minutes, 0),
      totalPence: timesheets.reduce((s, t) => s + t.total_pence, 0),
      pendingCount: timesheets.filter(t => !t.is_approved).length,
    };
  }

  async exportCsv(
    companyId: string,
    role: string,
    userId: string,
    filters: FilterTimesheetDto,
  ): Promise<string> {
    const timesheets = await this.findAll(companyId, userId, role, filters);

    const header =
      'Date,Engineer,Job,Start,Finish,Break (mins),Duration (hrs),Rate Type,Hourly Rate (£),Total (£),Approved,Notes';

    const rows = timesheets.map(ts => {
      const date = ts.date.toISOString().split('T')[0];
      const start = ts.start_time.toTimeString().slice(0, 5);
      const finish = ts.finish_time.toTimeString().slice(0, 5);
      const durationHrs = (ts.duration_minutes / 60).toFixed(2);
      const hourlyRate = (ts.hourly_rate_pence / 100).toFixed(2);
      const total = (ts.total_pence / 100).toFixed(2);
      return [
        date,
        `"${ts.user.name}"`,
        `"${ts.job?.title ?? ''}"`,
        start,
        finish,
        ts.break_minutes,
        durationHrs,
        ts.billing_rate,
        hourlyRate,
        total,
        ts.is_approved ? 'Yes' : 'No',
        `"${ts.notes?.replace(/"/g, '""') ?? ''}"`,
      ].join(',');
    });

    return [header, ...rows].join('\n');
  }

  // ── Schedule check helpers ────────────────────────────────────────────────────

  private async checkClockInSchedule(companyId: string, jobId: string): Promise<{
    type: 'NORMAL' | 'EARLY' | 'UNPLANNED';
    minutesEarly?: number;
    scheduledAt?: Date;
  }> {
    const job = await this.prisma.client.job.findFirst({
      where: { id: jobId, company_id: companyId },
      select: { scheduled_at: true, duration_minutes: true },
    });

    if (!job?.scheduled_at) return { type: 'UNPLANNED' };

    const now = new Date();
    const scheduled = new Date(job.scheduled_at);
    const minutesBefore = (scheduled.getTime() - now.getTime()) / 60000;

    if (minutesBefore > 10) {
      return { type: 'EARLY', minutesEarly: Math.round(minutesBefore), scheduledAt: scheduled };
    }
    return { type: 'NORMAL', scheduledAt: scheduled };
  }

  private async checkClockOutSchedule(companyId: string, jobId: string): Promise<{
    type: 'NORMAL' | 'EARLY_OUT' | 'LATE_OUT';
    minutesEarly?: number;
    minutesLate?: number;
  }> {
    const job = await this.prisma.client.job.findFirst({
      where: { id: jobId, company_id: companyId },
      select: { scheduled_at: true, duration_minutes: true },
    });

    if (!job?.scheduled_at || !job?.duration_minutes) return { type: 'NORMAL' };

    const now = new Date();
    const scheduledEnd = new Date(
      new Date(job.scheduled_at).getTime() + job.duration_minutes * 60000,
    );
    const minutesFromEnd = (now.getTime() - scheduledEnd.getTime()) / 60000;

    if (minutesFromEnd < -5) {
      return { type: 'EARLY_OUT', minutesEarly: Math.round(Math.abs(minutesFromEnd)) };
    }
    if (minutesFromEnd > 10) {
      return { type: 'LATE_OUT', minutesLate: Math.round(minutesFromEnd) };
    }
    return { type: 'NORMAL' };
  }

  // ── Get combined schedule status ──────────────────────────────────────────────

  async getTimerScheduleStatus(companyId: string, userId: string, jobId: string) {
    const [clockIn, clockOut, active] = await Promise.all([
      this.checkClockInSchedule(companyId, jobId),
      this.checkClockOutSchedule(companyId, jobId),
      this.prisma.client.activeTimer.findUnique({
        where: { user_id_job_id: { user_id: userId, job_id: jobId } },
      }),
    ]);
    return { clockIn, clockOut, isActive: !!active, activeTimer: active };
  }

  // ── Clock in ────────────────────────────────────────────────────────────────

  async clockIn(
    companyId: string,
    userId: string,
    jobId: string,
    location?: { lat: number; lng: number; address?: string },
    clockInData?: { flag?: string; reason?: string; note?: string },
  ) {
    const job = await this.prisma.client.job.findFirst({
      where: { id: jobId, company_id: companyId },
    });
    if (!job) throw new NotFoundException('Job not found');

    const existing = await this.prisma.client.activeTimer.findUnique({
      where: { user_id_job_id: { user_id: userId, job_id: jobId } },
    });
    if (existing) throw new BadRequestException('Already clocked in on this job');

    const timer = await this.prisma.client.activeTimer.create({
      data: {
        company_id: companyId,
        user_id: userId,
        job_id: jobId,
        started_at: new Date(),
        lat: location?.lat,
        lng: location?.lng,
        address: location?.address,
        clock_in_flag: clockInData?.flag,
        clock_in_reason: clockInData?.reason,
        clock_in_note: clockInData?.note,
      },
    });

    return { clocked_in: true, started_at: timer.started_at, timer_id: timer.id };
  }

  // ── Clock out ───────────────────────────────────────────────────────────────

  private static readonly APPROVAL_REASONS = [
    'AUTHORISED_OVERTIME',
    'MANAGER_APPROVED',
    'JOB_RAN_OVER',
    'EMERGENCY',
  ];

  async clockOut(
    companyId: string,
    userId: string,
    jobId: string,
    location?: { lat: number; lng: number; address?: string },
    clockOutData?: { flag?: string; reason?: string; note?: string },
  ) {
    const timer = await this.prisma.client.activeTimer.findUnique({
      where: { user_id_job_id: { user_id: userId, job_id: jobId } },
    });
    if (!timer) throw new NotFoundException('No active timer found for this job');

    const clockInAt = timer.started_at;
    const clockOutAt = new Date();

    const durationMs = clockOutAt.getTime() - clockInAt.getTime();
    const durationMinutes = Math.max(1, Math.round(durationMs / 60000));

    const startTime = clockInAt.toTimeString().slice(0, 5);
    const endTime = clockOutAt.toTimeString().slice(0, 5);
    const date = clockInAt.toISOString().split('T')[0]!;

    const company = await this.prisma.client.company.findUnique({
      where: { id: companyId },
      select: { standard_rate_pence: true },
    });
    const hourlyRate = company?.standard_rate_pence ?? 0;
    const totalPence = Math.round((durationMinutes / 60) * hourlyRate);

    const requiresApproval =
      timer.clock_in_flag === 'UNPLANNED' ||
      (!!timer.clock_in_reason && TimesheetsService.APPROVAL_REASONS.includes(timer.clock_in_reason)) ||
      (!!clockOutData?.reason && TimesheetsService.APPROVAL_REASONS.includes(clockOutData.reason));

    const timesheet = await this.prisma.client.$transaction(async (tx) => {
      await tx.activeTimer.delete({
        where: { user_id_job_id: { user_id: userId, job_id: jobId } },
      });

      return tx.timesheet.create({
        data: {
          company_id: companyId,
          user_id: userId,
          job_id: jobId,
          date: new Date(date),
          start_time: new Date(`${date}T${startTime}:00`),
          finish_time: new Date(`${date}T${endTime}:00`),
          break_minutes: 0,
          duration_minutes: durationMinutes,
          billing_rate: 'STANDARD',
          hourly_rate_pence: hourlyRate,
          total_pence: totalPence,
          is_timer_entry: true,
          clock_in_at: clockInAt,
          clock_out_at: clockOutAt,
          clock_in_lat: timer.lat,
          clock_in_lng: timer.lng,
          clock_in_address: timer.address,
          clock_out_lat: location?.lat,
          clock_out_lng: location?.lng,
          clock_out_address: location?.address,
          clock_in_flag: timer.clock_in_flag,
          clock_in_reason: timer.clock_in_reason,
          clock_in_note: timer.clock_in_note,
          clock_out_flag: clockOutData?.flag,
          clock_out_reason: clockOutData?.reason,
          clock_out_note: clockOutData?.note,
          requires_approval: requiresApproval,
          is_approved: false,
        },
        include: {
          user: { select: { id: true, name: true, email: true } },
          job: { select: { id: true, title: true } },
        },
      });
    });

    return { clocked_out: true, duration_minutes: durationMinutes, timesheet };
  }

  // ── Get active timer for a job ───────────────────────────────────────────────

  async getActiveTimer(userId: string, jobId: string) {
    const timer = await this.prisma.client.activeTimer.findUnique({
      where: { user_id_job_id: { user_id: userId, job_id: jobId } },
    });
    return timer ?? null;
  }

  // ── Get all active timers for company (owner view) ───────────────────────────

  async getActiveTimers(companyId: string) {
    return this.prisma.client.activeTimer.findMany({
      where: { company_id: companyId },
      include: {
        user: { select: { id: true, name: true } },
        job: { select: { id: true, title: true } },
      },
      orderBy: { started_at: 'asc' },
    });
  }

  // ── List timesheets requiring approval (exceptions queue) ─────────────────────

  async listRequiresApproval(companyId: string) {
    return this.prisma.client.timesheet.findMany({
      where: {
        company_id: companyId,
        requires_approval: true,
        is_approved: false,
      },
      include: {
        user: { select: { id: true, name: true } },
        job: { select: { id: true, title: true } },
      },
      orderBy: { date: 'desc' },
    });
  }

  private async resolveRate(companyId: string, billingRate: BillingRate): Promise<number> {
    const company = await this.prisma.client.company.findUnique({
      where: { id: companyId },
      select: {
        standard_rate_pence: true,
        overtime_rate_pence: true,
        double_time_rate_pence: true,
      },
    });
    if (!company) return 0;
    if (billingRate === 'STANDARD') return company.standard_rate_pence;
    if (billingRate === 'OVERTIME') return company.overtime_rate_pence;
    if (billingRate === 'DOUBLE_TIME') return company.double_time_rate_pence;
    return 0; // UNPAID
  }
}
