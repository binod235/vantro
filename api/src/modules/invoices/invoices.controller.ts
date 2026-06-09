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
import { InvoicesService } from './invoices.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { UpdateInvoiceDto } from './dto/update-invoice.dto';
import { CreateInvoiceFromQuoteDto } from './dto/create-invoice-from-quote.dto';
import { AddInvoicePaymentDto } from './dto/add-invoice-payment.dto';
import { MarkPaidDto } from './dto/mark-paid.dto';
import { UpdateInvoiceStatusDto } from './dto/update-invoice-status.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { CurrentUserType } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller('invoices')
@Roles('OWNER') // V1: invoices are OWNER-only
export class InvoicesController {
  constructor(private readonly invoicesService: InvoicesService) {}

  // ── GET /invoices?status=PAID&search=INV-001 ──────────────────────────────
  @Get()
  list(
    @CurrentUser() user: CurrentUserType,
    @Query('status') status?: string,
    @Query('search') search?: string,
  ) {
    return this.invoicesService.list(user.companyId!, { status, search });
  }

  // ── POST /invoices ────────────────────────────────────────────────────────
  @Post()
  create(
    @CurrentUser() user: CurrentUserType,
    @Body() dto: CreateInvoiceDto,
  ) {
    return this.invoicesService.create(user.companyId!, dto);
  }

  // ── POST /invoices/from-quote/:quoteId ────────────────────────────────────
  // NOTE: declared before :id routes to avoid collision
  @Post('from-quote/:quoteId')
  createFromQuote(
    @CurrentUser() user: CurrentUserType,
    @Param('quoteId') quoteId: string,
    @Body() dto: CreateInvoiceFromQuoteDto,
  ) {
    return this.invoicesService.createFromQuote(user.companyId!, quoteId, dto);
  }

  // ── POST /invoices/from-job/:jobId ────────────────────────────────────────
  @Post('from-job/:jobId')
  createFromJob(
    @CurrentUser() user: CurrentUserType,
    @Param('jobId') jobId: string,
  ) {
    return this.invoicesService.createFromJob(user.companyId!, jobId);
  }

  // ── GET /invoices/:id ─────────────────────────────────────────────────────
  @Get(':id')
  getOne(
    @CurrentUser() user: CurrentUserType,
    @Param('id') id: string,
  ) {
    return this.invoicesService.getOne(user.companyId!, id);
  }

  // ── PATCH /invoices/:id ───────────────────────────────────────────────────
  @Patch(':id')
  update(
    @CurrentUser() user: CurrentUserType,
    @Param('id') id: string,
    @Body() dto: UpdateInvoiceDto,
  ) {
    return this.invoicesService.update(user.companyId!, id, dto);
  }

  // ── PATCH /invoices/:id/status ────────────────────────────────────────────
  @Patch(':id/status')
  updateStatus(
    @CurrentUser() user: CurrentUserType,
    @Param('id') id: string,
    @Body() dto: UpdateInvoiceStatusDto,
  ) {
    return this.invoicesService.updateStatus(user.companyId!, id, dto.status);
  }

  // ── POST /invoices/:id/payments ───────────────────────────────────────────
  @Post(':id/payments')
  addPayment(
    @CurrentUser() user: CurrentUserType,
    @Param('id') id: string,
    @Body() dto: AddInvoicePaymentDto,
  ) {
    return this.invoicesService.addPayment(user.companyId!, id, dto);
  }

  // ── PATCH /invoices/:id/mark-paid ─────────────────────────────────────────
  @Patch(':id/mark-paid')
  @HttpCode(HttpStatus.OK)
  markPaid(
    @CurrentUser() user: CurrentUserType,
    @Param('id') id: string,
    @Body() dto: MarkPaidDto,
  ) {
    return this.invoicesService.markPaid(user.companyId!, id, dto);
  }

  // ── PATCH /invoices/:id/mark-unpaid ──────────────────────────────────────
  @Patch(':id/mark-unpaid')
  @HttpCode(HttpStatus.OK)
  markUnpaid(
    @CurrentUser() user: CurrentUserType,
    @Param('id') id: string,
  ) {
    return this.invoicesService.markUnpaid(user.companyId!, id);
  }

  // ── PATCH /invoices/:id/cancel ────────────────────────────────────────────
  @Patch(':id/cancel')
  @HttpCode(HttpStatus.OK)
  cancel(
    @CurrentUser() user: CurrentUserType,
    @Param('id') id: string,
  ) {
    return this.invoicesService.cancel(user.companyId!, id);
  }

  // ── DELETE /invoices/:id ──────────────────────────────────────────────────
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentUser() user: CurrentUserType,
    @Param('id') id: string,
  ): Promise<void> {
    await this.invoicesService.remove(user.companyId!, id);
  }

  // ── GET /invoices/:id/pdf ─────────────────────────────────────────────────
  @Get(':id/pdf')
  async getPdf(
    @CurrentUser() user: CurrentUserType,
    @Param('id') id: string,
    @Res() res: {
      setHeader(name: string, value: string): void;
      end(body: Buffer): void;
    },
  ): Promise<void> {
    const buffer = await this.invoicesService.generatePdf(user.companyId!, id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="invoice-${id}.pdf"`);
    res.setHeader('Content-Length', String(buffer.length));
    res.end(buffer);
  }

  // ── POST /invoices/:id/email ──────────────────────────────────────────────
  @Post(':id/email')
  emailInvoice(
    @CurrentUser() user: CurrentUserType,
    @Param('id') id: string,
  ) {
    return this.invoicesService.emailInvoice(user.companyId!, id);
  }
}