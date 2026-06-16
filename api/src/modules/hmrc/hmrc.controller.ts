import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { HmrcService }   from './hmrc.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CurrentUser, type CurrentUserType } from '../auth/decorators/current-user.decorator';
import { Roles }   from '../auth/decorators/roles.decorator';
import { Public }  from '../auth/decorators/public.decorator';

@Controller('hmrc')
export class HmrcController {
  constructor(
    private readonly hmrc:   HmrcService,
    private readonly prisma: PrismaService,
  ) {}

  // Get connection status
  @Get('status')
  @Roles('OWNER')
  status(@CurrentUser() user: CurrentUserType) {
    return this.hmrc.getStatus(user.companyId!);
  }

  // Start OAuth flow — redirects browser to HMRC Government Gateway login
  @Get('connect')
  @Roles('OWNER')
  connect(
    @CurrentUser() user: CurrentUserType,
    @Res() res: Response,
  ) {
    const url = this.hmrc.getAuthorizationUrl(user.companyId!);
    res.redirect(url);
  }

  // OAuth callback — HMRC redirects here with auth code after login
  // Must be @Public() — user is unauthenticated when HMRC redirects back
  @Get('callback')
  @Public()
  async callback(
    @Res() res: Response,
  ) {
    const FRONTEND = process.env.FRONTEND_URL ?? 'http://localhost:3001';
    // NestJS doesn't give us @Query() when using @Res() without passthrough
    // so we read the raw query from the response object's request
    const req = (res as unknown as { req: { query: Record<string, string> } }).req;
    const code      = req.query['code']  ?? '';
    const companyId = req.query['state'] ?? '';

    try {
      await this.hmrc.exchangeCodeForTokens(companyId, code);
      res.redirect(`${FRONTEND}/dashboard/settings?hmrc=connected`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      res.redirect(
        `${FRONTEND}/dashboard/settings?hmrc=error&msg=${encodeURIComponent(msg)}`,
      );
    }
  }

  // Disconnect HMRC account
  @Delete('disconnect')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles('OWNER')
  async disconnect(@CurrentUser() user: CurrentUserType): Promise<void> {
    await this.hmrc.disconnect(user.companyId!);
  }

  // Save company NI number (required for CIS deductions API)
  @Post('nino')
  @Roles('OWNER')
  async updateNino(
    @CurrentUser() user: CurrentUserType,
    @Body() body: { nino: string },
  ) {
    const clean = (body.nino ?? '').replace(/\s/g, '').toUpperCase();
    const ninoRegex = /^[A-Z]{2}\d{6}[A-D]$/;
    if (!ninoRegex.test(clean)) {
      throw new BadRequestException('Invalid NI number format. Example: AB123456C');
    }
    await this.hmrc.updateNino(user.companyId!, clean);
    return { updated: true };
  }

  // Submit a single suffered deduction to HMRC CIS Deductions MTD API
  @Post('cis/suffered/:id/submit')
  @Roles('OWNER')
  submitDeduction(
    @CurrentUser() user: CurrentUserType,
    @Param('id') deductionId: string,
  ) {
    return this.hmrc.submitSufferedDeduction(user.companyId!, deductionId);
  }

  // Retrieve deductions HMRC holds for the company for a tax year
  @Get('cis/retrieve/:taxYear')
  @Roles('OWNER')
  retrieve(
    @CurrentUser() user: CurrentUserType,
    @Param('taxYear') taxYear: string,
  ) {
    return this.hmrc.retrieveSufferedDeductions(user.companyId!, taxYear);
  }
}
