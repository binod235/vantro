import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { TimesheetsService } from './timesheets.service';
import { CreateTimesheetDto } from './create-timesheet.dto';
import { UpdateTimesheetDto } from './update-timesheet.dto';
import { FilterTimesheetDto } from './filter-timesheet.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { CurrentUserType } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller('timesheets')
export class TimesheetsController {
  constructor(private readonly timesheetsService: TimesheetsService) {}

  /** List timesheets. Engineers see only their own. */
  @Get()
  findAll(
    @CurrentUser() user: CurrentUserType,
    @Query() filters: FilterTimesheetDto,
  ) {
    if (!user.companyId) return [];
    return this.timesheetsService.findAll(user.companyId, user.id, user.role, filters);
  }

  /** Aggregated summary — OWNER only. Must be before /:id. */
  @Get('summary')
  @Roles('OWNER')
  getSummary(
    @CurrentUser() user: CurrentUserType,
    @Query() filters: FilterTimesheetDto,
  ) {
    return this.timesheetsService.getSummary(user.companyId!, filters);
  }

  /** CSV export. Must be before /:id. Inline Res type avoids emitDecoratorMetadata issue. */
  @Get('export')
  async exportCsv(
    @CurrentUser() user: CurrentUserType,
    @Query() filters: FilterTimesheetDto,
    @Res() res: { setHeader(n: string, v: string): void; send(body: string): void },
  ) {
    const csv = await this.timesheetsService.exportCsv(
      user.companyId!,
      user.role,
      user.id,
      filters,
    );
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="timesheets.csv"');
    res.send(csv);
  }

  /** Create a timesheet entry. Any role — engineers can only log for themselves. */
  @Post()
  create(
    @Body() dto: CreateTimesheetDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.timesheetsService.create(user.companyId!, user.id, user.role, dto);
  }

  /** Clock in to a job — starts active timer. Both OWNER and ENGINEER. */
  @Post('timer/clock-in')
  clockIn(
    @CurrentUser() user: CurrentUserType,
    @Body()
    body: {
      job_id: string;
      lat?: number;
      lng?: number;
      address?: string;
      flag?: string;
      reason?: string;
      note?: string;
    },
  ) {
    return this.timesheetsService.clockIn(
      user.companyId!,
      user.id,
      body.job_id,
      body.lat !== undefined
        ? { lat: body.lat, lng: body.lng!, address: body.address }
        : undefined,
      body.flag !== undefined ? { flag: body.flag, reason: body.reason, note: body.note } : undefined,
    );
  }

  /** Clock out of a job — stops timer and creates timesheet entry. */
  @Post('timer/clock-out')
  clockOut(
    @CurrentUser() user: CurrentUserType,
    @Body()
    body: {
      job_id: string;
      lat?: number;
      lng?: number;
      address?: string;
      flag?: string;
      reason?: string;
      note?: string;
    },
  ) {
    return this.timesheetsService.clockOut(
      user.companyId!,
      user.id,
      body.job_id,
      body.lat !== undefined
        ? { lat: body.lat, lng: body.lng!, address: body.address }
        : undefined,
      body.flag !== undefined ? { flag: body.flag, reason: body.reason, note: body.note } : undefined,
    );
  }

  /** Get schedule status for clock-in/out decision. Must be before /:id. */
  @Get('timer/schedule-status')
  getScheduleStatus(
    @CurrentUser() user: CurrentUserType,
    @Query('job_id') jobId: string,
  ) {
    return this.timesheetsService.getTimerScheduleStatus(user.id, jobId);
  }

  /** Get active timer for a job (for current user). */
  @Get('timer/active')
  getActiveTimer(
    @CurrentUser() user: CurrentUserType,
    @Query('job_id') jobId: string,
  ) {
    return this.timesheetsService.getActiveTimer(user.id, jobId);
  }

  /** Get all active timers for the company — OWNER only. */
  @Get('timer/all')
  @Roles('OWNER')
  getActiveTimers(@CurrentUser() user: CurrentUserType) {
    return this.timesheetsService.getActiveTimers(user.companyId!);
  }

  /** Exceptions queue — timesheets needing approval. OWNER only. Must be before /:id. */
  @Get('requires-approval')
  @Roles('OWNER')
  listRequiresApproval(@CurrentUser() user: CurrentUserType) {
    return this.timesheetsService.listRequiresApproval(user.companyId!);
  }

  /** Get single timesheet. Engineers can only see their own. */
  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: CurrentUserType) {
    return this.timesheetsService.findOne(user.companyId!, user.id, user.role, id);
  }

  /** Update a timesheet. Blocked if approved. Engineers can only edit their own. */
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateTimesheetDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.timesheetsService.update(user.companyId!, user.id, user.role, id, dto);
  }

  /** Approve a timesheet — OWNER only. */
  @Patch(':id/approve')
  @Roles('OWNER')
  approve(@Param('id') id: string, @CurrentUser() user: CurrentUserType) {
    return this.timesheetsService.approve(user.companyId!, user.id, id);
  }

  /** Unapprove a timesheet — OWNER only. */
  @Patch(':id/unapprove')
  @Roles('OWNER')
  unapprove(@Param('id') id: string, @CurrentUser() user: CurrentUserType) {
    return this.timesheetsService.unapprove(user.companyId!, id);
  }

  /** Delete a timesheet. Blocked if approved. Engineers can only delete their own. */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string, @CurrentUser() user: CurrentUserType) {
    return this.timesheetsService.remove(user.companyId!, user.id, user.role, id);
  }
}
