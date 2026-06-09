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
} from '@nestjs/common';
import { JobsService } from './jobs.service';
import { CreateJobDto } from './dto/create-job.dto';
import { UpdateJobDto } from './dto/update-job.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { CurrentUserType } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller('jobs')
export class JobsController {
  constructor(private readonly jobsService: JobsService) {}

  /** Owner creates a new job and assigns it to a customer. */
  @Post()
  @Roles('OWNER')
  create(@Body() dto: CreateJobDto, @CurrentUser() user: CurrentUserType) {
    return this.jobsService.create(dto, user.companyId!);
  }

  /** Scheduled jobs between start and end dates. Used by the calendar. */
  @Get('schedule')
  findScheduled(
    @CurrentUser() user: CurrentUserType,
    @Query('start') start: string,
    @Query('end') end: string,
  ) {
    if (!user.companyId) return [];
    return this.jobsService.findScheduled(
      user.companyId,
      user.id,
      user.role === 'OWNER',
      start,
      end,
    );
  }

  /**
   * List jobs. Owner sees all jobs in the company.
   * Engineer sees only jobs where they are the assigned engineer.
   */
  @Get()
  findAll(@CurrentUser() user: CurrentUserType) {
    if (!user.companyId) return [];
    return this.jobsService.findAll(
      user.companyId,
      user.id,
      user.role === 'OWNER',
    );
  }

  /**
   * Get a single job. Owner can fetch any job in the company.
   * Engineer can only fetch jobs they are assigned to.
   */
  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: CurrentUserType) {
    if (!user.companyId) throw new Error('No company');
    return this.jobsService.findOne(
      id,
      user.companyId,
      user.id,
      user.role === 'OWNER',
    );
  }

  /** Update a job — status, assignment, schedule, or description. Owner only. */
  @Patch(':id')
  @Roles('OWNER')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateJobDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.jobsService.update(id, dto, user.companyId!);
  }

  /**
   * Delete a job. Owner only.
   * Returns 409 if the job has related records (timesheets, certificates, etc.).
   */
  @Delete(':id')
  @Roles('OWNER')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string, @CurrentUser() user: CurrentUserType) {
    return this.jobsService.remove(id, user.companyId!);
  }
}
