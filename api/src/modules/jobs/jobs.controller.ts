import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { JobsService } from './jobs.service';
import { JobPhotosService } from './job-photos.service';
import { JobStagesService } from './job-stages.service';
import { JobTemplatesService } from './job-templates.service';
import { OnMyWayService } from './on-my-way.service';
import { CreateJobDto } from './dto/create-job.dto';
import { UpdateJobDto } from './dto/update-job.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { CurrentUserType } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller('jobs')
export class JobsController {
  constructor(
    private readonly jobsService:          JobsService,
    private readonly jobPhotosService:     JobPhotosService,
    private readonly jobStagesService:     JobStagesService,
    private readonly jobTemplatesService:  JobTemplatesService,
    private readonly onMyWayService:       OnMyWayService,
  ) {}

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

  // ── Job Templates (MUST be before /:id routes) ────────────────────────────

  @Get('templates')
  @Roles('OWNER')
  listTemplates(@CurrentUser() user: CurrentUserType) {
    return this.jobTemplatesService.list(user.companyId!);
  }

  @Post('templates')
  @Roles('OWNER')
  createTemplate(
    @CurrentUser() user: CurrentUserType,
    @Body() dto: Record<string, unknown>,
  ) {
    return this.jobTemplatesService.create(user.companyId!, dto as never);
  }

  @Put('templates/:id')
  @Roles('OWNER')
  updateTemplate(
    @CurrentUser() user: CurrentUserType,
    @Param('id') id: string,
    @Body() dto: Record<string, unknown>,
  ) {
    return this.jobTemplatesService.update(user.companyId!, id, dto as never);
  }

  @Delete('templates/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles('OWNER')
  async removeTemplate(
    @CurrentUser() user: CurrentUserType,
    @Param('id') id: string,
  ): Promise<void> {
    await this.jobTemplatesService.remove(user.companyId!, id);
  }

  @Post('templates/:id/use')
  @HttpCode(HttpStatus.OK)
  @Roles('OWNER')
  useTemplate(
    @CurrentUser() user: CurrentUserType,
    @Param('id') id: string,
  ) {
    return this.jobTemplatesService.incrementUseCount(user.companyId!, id);
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

  // ── On My Way ──────────────────────────────────────────────────────────────

  @Post(':id/on-my-way')
  sendOnMyWay(@Param('id') id: string, @CurrentUser() user: CurrentUserType) {
    return this.onMyWayService.send(id, user.companyId!, user.id);
  }

  // ── Photos ─────────────────────────────────────────────────────────────────

  @Get(':id/photos')
  listPhotos(
    @CurrentUser() user: CurrentUserType,
    @Param('id') id: string,
  ) {
    return this.jobPhotosService.list(user.companyId!, id);
  }

  @Post(':id/photos')
  @UseInterceptors(
    FileInterceptor('photo', {
      storage: memoryStorage(),
      limits: { fileSize: 15 * 1024 * 1024 },
      fileFilter: (_, file, cb) => {
        const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
        if (allowed.includes(file.mimetype)) {
          cb(null, true);
        } else {
          cb(new BadRequestException('Only images are allowed'), false);
        }
      },
    }),
  )
  async uploadPhoto(
    @CurrentUser() user: CurrentUserType,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @Body('caption') caption?: string,
    @Body('phase') phase?: string,
  ) {
    if (!file) throw new BadRequestException('No image provided');
    return this.jobPhotosService.upload(
      user.companyId!,
      id,
      user.id,
      file,
      caption,
      phase,
    );
  }

  @Delete(':id/photos/:photoId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removePhoto(
    @CurrentUser() user: CurrentUserType,
    @Param('id') _id: string,
    @Param('photoId') photoId: string,
  ): Promise<void> {
    await this.jobPhotosService.remove(
      user.companyId!,
      photoId,
      user.id,
      user.role,
    );
  }

  // ── Stages ─────────────────────────────────────────────────────────────────

  @Get(':jobId/stages')
  @Roles('OWNER')
  listStages(
    @CurrentUser() user: CurrentUserType,
    @Param('jobId') jobId: string,
  ) {
    return this.jobStagesService.list(user.companyId!, jobId);
  }

  @Post(':jobId/stages')
  @Roles('OWNER')
  createStage(
    @CurrentUser() user: CurrentUserType,
    @Param('jobId') jobId: string,
    @Body() dto: Record<string, unknown>,
  ) {
    return this.jobStagesService.create(user.companyId!, jobId, dto as never);
  }

  @Put(':jobId/stages/:stageId')
  @Roles('OWNER')
  updateStage(
    @CurrentUser() user: CurrentUserType,
    @Param('stageId') stageId: string,
    @Body() dto: Record<string, unknown>,
  ) {
    return this.jobStagesService.update(user.companyId!, stageId, dto as never);
  }

  @Delete(':jobId/stages/:stageId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles('OWNER')
  async deleteStage(
    @CurrentUser() user: CurrentUserType,
    @Param('stageId') stageId: string,
  ): Promise<void> {
    await this.jobStagesService.remove(user.companyId!, stageId);
  }

  @Post(':jobId/stages/:stageId/create-invoice')
  @HttpCode(HttpStatus.CREATED)
  @Roles('OWNER')
  createInvoiceFromStage(
    @CurrentUser() user: CurrentUserType,
    @Param('stageId') stageId: string,
  ) {
    return this.jobStagesService.createInvoiceFromStage(user.companyId!, stageId);
  }
}
