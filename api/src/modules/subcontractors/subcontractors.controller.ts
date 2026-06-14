import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { SubcontractorsService } from './subcontractors.service';
import { SubcontractorPaymentsService } from './subcontractor-payments.service';
import { CisEngineService } from './cis-engine.service';
import { CisSufferedService } from './cis-suffered.service';
import { CreateSubcontractorDto } from './dto/create-subcontractor.dto';
import { UpdateSubcontractorDto } from './dto/update-subcontractor.dto';
import { VerifySubcontractorDto } from './dto/verify-subcontractor.dto';
import { CurrentUser, type CurrentUserType } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller('subcontractors')
@Roles('OWNER')
export class SubcontractorsController {
  constructor(
    private readonly subcontractorsService: SubcontractorsService,
    private readonly paymentsService: SubcontractorPaymentsService,
    private readonly cisEngineService: CisEngineService,
    private readonly sufferedService: CisSufferedService,
  ) {}

  // ── Subcontractor CRUD ────────────────────────────────────────────────────

  @Get()
  findAll(
    @CurrentUser() user: CurrentUserType,
    @Query('inactive') inactive?: string,
  ) {
    return this.subcontractorsService.findAll(user.companyId!, inactive === 'true');
  }

  @Post()
  create(@Body() dto: CreateSubcontractorDto, @CurrentUser() user: CurrentUserType) {
    return this.subcontractorsService.create(user.companyId!, dto);
  }

  // ── Payment routes — MUST be before /:id to avoid route collision ─────────

  @Get('payments')
  listPayments(
    @CurrentUser() user: CurrentUserType,
    @Query('subcontractor_id') subcontractor_id?: string,
    @Query('tax_month') tax_month?: string,
    @Query('job_id') job_id?: string,
  ) {
    return this.paymentsService.list(user.companyId!, { subcontractor_id, tax_month, job_id });
  }

  @Post('payments')
  createPayment(
    @CurrentUser() user: CurrentUserType,
    @Body() dto: Record<string, unknown>,
  ) {
    return this.paymentsService.create(user.companyId!, dto as never);
  }

  @Post('payments/preview')
  @HttpCode(HttpStatus.OK)
  previewPayment(
    @CurrentUser() user: CurrentUserType,
    @Body() dto: Record<string, unknown>,
  ) {
    return this.paymentsService.previewCalculation(dto as never);
  }

  @Get('payments/:paymentId')
  getPayment(
    @CurrentUser() user: CurrentUserType,
    @Param('paymentId') paymentId: string,
  ) {
    return this.paymentsService.getOne(user.companyId!, paymentId);
  }

  @Put('payments/:paymentId')
  updatePayment(
    @CurrentUser() user: CurrentUserType,
    @Param('paymentId') paymentId: string,
    @Body() dto: Record<string, unknown>,
  ) {
    return this.paymentsService.update(user.companyId!, paymentId, dto as never);
  }

  @Delete('payments/:paymentId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deletePayment(
    @CurrentUser() user: CurrentUserType,
    @Param('paymentId') paymentId: string,
  ): Promise<void> {
    await this.paymentsService.remove(user.companyId!, paymentId);
  }

  // ── CIS Engine — BEFORE /:id routes ──────────────────────────────────────

  @Get('cis/months')
  getAvailableMonths(@CurrentUser() user: CurrentUserType) {
    return this.cisEngineService.getAvailableTaxMonths(user.companyId!);
  }

  @Get('cis/current-month')
  getCurrentMonth() {
    return { tax_month: this.cisEngineService.getCurrentTaxMonth() };
  }

  @Get('cis/return/:taxMonth/pdf')
  async downloadCis300(
    @CurrentUser() user: CurrentUserType,
    @Param('taxMonth') taxMonth: string,
    @Res() res: Response,
  ): Promise<void> {
    const buf = await this.cisEngineService.generateCis300Pdf(user.companyId!, taxMonth, user.name ?? 'Owner');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="CIS300-${taxMonth}.pdf"`);
    res.setHeader('Content-Length', String(buf.length));
    res.end(buf);
  }

  @Get('cis/return/:taxMonth/csv')
  async downloadCis300Csv(
    @CurrentUser() user: CurrentUserType,
    @Param('taxMonth') taxMonth: string,
    @Res() res: Response,
  ): Promise<void> {
    const csv = await this.cisEngineService.generateCis300Csv(user.companyId!, taxMonth, user.name ?? 'Owner');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="CIS300-${taxMonth}.csv"`);
    res.end(csv);
  }

  @Post('cis/return/:taxMonth/submit')
  @HttpCode(HttpStatus.OK)
  markSubmitted(
    @CurrentUser() user: CurrentUserType,
    @Param('taxMonth') taxMonth: string,
    @Body() dto: { hmrc_reference?: string; notes?: string },
  ) {
    return this.cisEngineService.markSubmitted(
      user.companyId!, taxMonth, user.id, user.name ?? 'Owner', dto,
    );
  }

  @Get('cis/return/:taxMonth/status')
  getReturnStatus(
    @CurrentUser() user: CurrentUserType,
    @Param('taxMonth') taxMonth: string,
  ) {
    return this.cisEngineService.getSubmissionStatus(user.companyId!, taxMonth);
  }

  @Get('cis/summary/:taxMonth')
  getMonthlySummary(
    @CurrentUser() user: CurrentUserType,
    @Param('taxMonth') taxMonth: string,
  ) {
    return this.cisEngineService.getMonthlySummary(user.companyId!, taxMonth);
  }

  @Get('cis/audit')
  getAuditLog(
    @CurrentUser() user: CurrentUserType,
    @Query('tax_month') taxMonth?: string,
    @Query('limit') limit?: string,
  ) {
    return this.cisEngineService.getAuditLog(
      user.companyId!,
      taxMonth,
      limit ? parseInt(limit) : 50,
    );
  }

  @Get('cis/year/:taxYear/csv')
  async downloadAnnualCsv(
    @CurrentUser() user: CurrentUserType,
    @Param('taxYear') taxYear: string,
    @Res() res: Response,
  ): Promise<void> {
    const csv = await this.cisEngineService.generateAnnualReconciliationCsv(
      user.companyId!, taxYear, user.name ?? 'Owner',
    );
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="CIS-Annual-${taxYear}.csv"`);
    res.end(csv);
  }

  @Get('cis/year/:taxYear')
  getTaxYearSummary(
    @CurrentUser() user: CurrentUserType,
    @Param('taxYear') taxYear: string,
  ) {
    return this.cisEngineService.getTaxYearSummary(user.companyId!, taxYear);
  }

  @Get('cis/pds/:subcontractorId/:taxMonth')
  async downloadPds(
    @CurrentUser() user: CurrentUserType,
    @Param('subcontractorId') subcontractorId: string,
    @Param('taxMonth') taxMonth: string,
    @Res() res: Response,
  ): Promise<void> {
    const buf = await this.cisEngineService.generatePdsForSubcontractor(
      user.companyId!, subcontractorId, taxMonth, user.name ?? 'Owner',
    );
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="CIS-Statement-${taxMonth}.pdf"`);
    res.setHeader('Content-Length', String(buf.length));
    res.end(buf);
  }

  @Post('cis/pds/:subcontractorId/:taxMonth/send')
  @HttpCode(HttpStatus.OK)
  sendPds(
    @CurrentUser() user: CurrentUserType,
    @Param('subcontractorId') subcontractorId: string,
    @Param('taxMonth') taxMonth: string,
  ) {
    return this.cisEngineService.sendPdsEmail(
      user.companyId!, subcontractorId, taxMonth, user.name ?? 'Owner',
    );
  }

  // ── Suffered deductions — BEFORE /:id routes ─────────────────────────────

  @Get('suffered')
  listSuffered(
    @CurrentUser() user: CurrentUserType,
    @Query('tax_month') tax_month?: string,
  ) {
    return this.sufferedService.list(user.companyId!, tax_month);
  }

  @Post('suffered')
  createSuffered(
    @CurrentUser() user: CurrentUserType,
    @Body() dto: Record<string, unknown>,
  ) {
    return this.sufferedService.create(user.companyId!, dto as never);
  }

  @Delete('suffered/:sufferedId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeSuffered(
    @CurrentUser() user: CurrentUserType,
    @Param('sufferedId') sufferedId: string,
  ): Promise<void> {
    await this.sufferedService.remove(user.companyId!, sufferedId);
  }

  // ── Subcontractor by ID — AFTER payment + cis + suffered routes ───────────

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: CurrentUserType) {
    return this.subcontractorsService.findOne(user.companyId!, id);
  }

  @Put(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateSubcontractorDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.subcontractorsService.update(user.companyId!, id, dto);
  }

  @Post(':id/verify')
  recordVerification(
    @Param('id') id: string,
    @Body() dto: VerifySubcontractorDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.subcontractorsService.recordVerification(user.companyId!, id, user.id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') id: string, @CurrentUser() user: CurrentUserType): Promise<void> {
    await this.subcontractorsService.remove(user.companyId!, id);
  }
}
