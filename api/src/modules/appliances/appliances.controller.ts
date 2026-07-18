import {
  Body, Controller, Delete, Get, HttpCode,
  Param, Post, Put, Query,
} from '@nestjs/common';
import { AppliancesService } from './appliances.service';
import { CreateApplianceDto } from './dto/create-appliance.dto';
import { UpdateApplianceDto } from './dto/update-appliance.dto';
import { CurrentUser, type CurrentUserType } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { Public } from '../auth/decorators/public.decorator';

@Controller('api/appliances')
export class AppliancesController {
  constructor(private readonly appliancesService: AppliancesService) {}

  // ── Public endpoints — BEFORE :id routes ───────────────────────────────

  /** Customer scans QR → public passport */
  @Get('public/:token')
  @Public()
  getPublicPassport(@Param('token') token: string) {
    return this.appliancesService.getPublicPassport(token);
  }

  /** Authed engineer/owner scans QR → full view */
  @Get('full/:token')
  getFullPassport(
    @Param('token') token: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.appliancesService.getFullPassport(token, user.companyId!);
  }

  /** Due soon — for Pip and dashboard */
  @Get('due-soon')
  @Roles('OWNER')
  getDueSoon(
    @CurrentUser() user: CurrentUserType,
    @Query('days') days?: string,
  ) {
    return this.appliancesService.getDueForCompany(user.companyId!, days ? Number(days) : 60);
  }

  /** List for a customer */
  @Get('customer/:customerId')
  listForCustomer(
    @Param('customerId') customerId: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.appliancesService.findAllForCustomer(customerId, user.companyId!);
  }

  /** QR data for printing */
  @Get(':id/qr')
  getQrData(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.appliancesService.getQrData(id, user.companyId!);
  }

  /** Sticker page data — QR data URI + company branding */
  @Get(':id/sticker-data')
  getStickerData(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.appliancesService.getStickerData(id, user.companyId!);
  }

  // ── Standard CRUD ───────────────────────────────────────────────────────

  @Get(':id')
  findOne(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.appliancesService.findOne(id, user.companyId!);
  }

  @Post()
  @Roles('OWNER')
  create(
    @Body() dto: CreateApplianceDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.appliancesService.create(dto, user.companyId!);
  }

  @Put(':id')
  @Roles('OWNER')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateApplianceDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.appliancesService.update(id, dto, user.companyId!);
  }

  @Delete(':id')
  @Roles('OWNER')
  @HttpCode(204)
  remove(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.appliancesService.remove(id, user.companyId!);
  }
}
