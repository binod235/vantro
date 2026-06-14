import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser, type CurrentUserType } from '../auth/decorators/current-user.decorator';
import { PurchaseOrdersService } from './purchase-orders.service';

@Controller('purchase-orders')
@Roles('OWNER')
export class PurchaseOrdersController {
  constructor(private readonly service: PurchaseOrdersService) {}

  // ── Job costing — MUST be before :id routes ───────────────────────────────

  @Get('costing/report')
  getCostingReport(@CurrentUser() user: CurrentUserType) {
    return this.service.getJobCostingReport(user.companyId!);
  }

  @Get('costing/job/:jobId')
  getJobCosting(
    @CurrentUser() user: CurrentUserType,
    @Param('jobId') jobId: string,
  ) {
    return this.service.getJobCosting(user.companyId!, jobId);
  }

  // ── List + create ─────────────────────────────────────────────────────────

  @Get()
  list(
    @CurrentUser() user: CurrentUserType,
    @Query('job_id') jobId?: string,
    @Query('status') status?: string,
  ) {
    return this.service.list(user.companyId!, { job_id: jobId, status });
  }

  @Post()
  create(
    @CurrentUser() user: CurrentUserType,
    @Body() body: {
      job_id?:        string;
      supplier_id?:   string;
      line_items:     { description: string; quantity: number; unit_cost_pence: number }[];
      notes?:         string;
      expected_date?: string;
    },
  ) {
    return this.service.create(user.companyId!, body);
  }

  // ── Single PO ─────────────────────────────────────────────────────────────

  @Get(':id')
  getOne(@CurrentUser() user: CurrentUserType, @Param('id') id: string) {
    return this.service.getOne(user.companyId!, id);
  }

  @Put(':id')
  update(
    @CurrentUser() user: CurrentUserType,
    @Param('id') id: string,
    @Body() body: {
      supplier_id?:   string | null;
      job_id?:        string | null;
      line_items?:    { description: string; quantity: number; unit_cost_pence: number }[];
      notes?:         string;
      expected_date?: string;
    },
  ) {
    return this.service.update(user.companyId!, id, body);
  }

  @Patch(':id/receive')
  markReceived(@CurrentUser() user: CurrentUserType, @Param('id') id: string) {
    return this.service.markReceived(user.companyId!, id);
  }

  @Patch(':id/cancel')
  cancel(@CurrentUser() user: CurrentUserType, @Param('id') id: string) {
    return this.service.cancel(user.companyId!, id);
  }

  @Delete(':id')
  remove(@CurrentUser() user: CurrentUserType, @Param('id') id: string) {
    return this.service.remove(user.companyId!, id);
  }

  @Get(':id/pdf')
  async getPdf(
    @CurrentUser() user: CurrentUserType,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const po  = await this.service.getOne(user.companyId!, id);
    const buf = await this.service.generatePdf(user.companyId!, id);
    res.set({
      'Content-Type':        'application/pdf',
      'Content-Disposition': `attachment; filename="${po.po_number}.pdf"`,
      'Content-Length':      buf.length,
    });
    res.end(buf);
  }

  @Post(':id/send')
  sendToSupplier(@CurrentUser() user: CurrentUserType, @Param('id') id: string) {
    return this.service.sendToSupplier(user.companyId!, id);
  }
}
