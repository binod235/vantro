import {
  Body, Controller, Delete, Get, HttpCode, HttpStatus,
  Param, Patch, Post, Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { Roles }       from '../auth/decorators/roles.decorator';
import { Public }      from '../auth/decorators/public.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { CurrentUserType } from '../auth/decorators/current-user.decorator';
import { JsrService }  from './jsr.service';

@Controller('job-service-reports')
export class JsrController {
  constructor(private readonly jsr: JsrService) {}

  // ── Public token routes — MUST come before :id param routes ──────────────

  @Public()
  @Get('public/:token')
  async getPublic(@Param('token') token: string) {
    return this.jsr.getPublicByToken(token);
  }

  @Public()
  @Post('public/:token/accept')
  @HttpCode(HttpStatus.OK)
  async accept(@Param('token') token: string) {
    return this.jsr.acceptByToken(token);
  }

  @Public()
  @Post('public/:token/decline')
  @HttpCode(HttpStatus.OK)
  async decline(
    @Param('token') token: string,
    @Body() body: { reason?: string },
  ) {
    return this.jsr.declineByToken(token, body.reason);
  }

  // ── Authenticated routes ───────────────────────────────────────────────────
  // Engineers can view/create/send/download reports for their own field work
  // (they're the ones on site getting sign-off) — editing display options and
  // deleting reports stays OWNER-only, see below.

  @Roles('OWNER')
  @Get('job/:jobId/preview')
  async preview(
    @Param('jobId') jobId: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.jsr.previewJobData(user.companyId!, jobId);
  }

  @Roles('OWNER', 'ENGINEER')
  @Get('job/:jobId')
  async listByJob(
    @Param('jobId') jobId: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.jsr.list(user.companyId!, jobId);
  }

  @Roles('OWNER', 'ENGINEER')
  @Post('job/:jobId')
  async create(
    @Param('jobId') jobId: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.jsr.create(user.companyId!, jobId);
  }

  @Roles('OWNER', 'ENGINEER')
  @Get(':id')
  async getOne(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.jsr.getOne(user.companyId!, id);
  }

  @Roles('OWNER')
  @Patch(':id')
  async update(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserType,
    @Body() body: {
      title?:           string;
      description?:     string | null;
      terms?:           string | null;
      show_timesheets?: boolean;
      show_certs?:      boolean;
      show_photos?:     boolean;
      show_notes?:      boolean;
    },
  ) {
    return this.jsr.update(user.companyId!, id, body);
  }

  @Roles('OWNER', 'ENGINEER')
  @Post(':id/send')
  @HttpCode(HttpStatus.OK)
  async send(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.jsr.sendToCustomer(user.companyId!, id);
  }

  @Roles('OWNER', 'ENGINEER')
  @Get(':id/pdf')
  async downloadPdf(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserType,
    @Res() res: Response,
  ) {
    const buf = await this.jsr.generatePdf(user.companyId!, id);
    const jsr = await this.jsr.getOne(user.companyId!, id);
    res.set({
      'Content-Type':        'application/pdf',
      'Content-Disposition': `attachment; filename="${jsr.report_number}.pdf"`,
      'Content-Length':      String(buf.length),
    });
    res.end(buf);
  }

  @Roles('OWNER')
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    await this.jsr.remove(user.companyId!, id);
  }
}
