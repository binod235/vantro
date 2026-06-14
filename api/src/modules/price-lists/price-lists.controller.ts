import {
  Body, Controller, Delete, Get, HttpCode, HttpStatus,
  Param, Post, Put, Query,
} from '@nestjs/common';
import { PriceListsService }  from './price-lists.service';
import { CurrentUser, type CurrentUserType } from '../auth/decorators/current-user.decorator';
import { Roles }              from '../auth/decorators/roles.decorator';

@Controller('price-lists')
@Roles('OWNER')
export class PriceListsController {
  constructor(private readonly svc: PriceListsService) {}

  // ── Price List Items ──────────────────────────────────────────────────────

  @Get('items')
  listItems(
    @CurrentUser() user: CurrentUserType,
    @Query('supplier_id') supplier_id?: string,
    @Query('search') search?: string,
  ) {
    return this.svc.listItems(user.companyId!, { supplier_id, search });
  }

  @Post('items/import-csv')
  importCsv(
    @CurrentUser() user: CurrentUserType,
    @Body() body: { supplier_id?: string; rows: Record<string, string>[] },
  ) {
    return this.svc.importFromCsv(
      user.companyId!,
      body.supplier_id ?? null,
      body.rows as never,
    );
  }

  @Post('items')
  createItem(
    @CurrentUser() user: CurrentUserType,
    @Body() dto: Record<string, unknown>,
  ) {
    return this.svc.createItem(user.companyId!, dto as never);
  }

  @Put('items/:id')
  updateItem(
    @CurrentUser() user: CurrentUserType,
    @Param('id') id: string,
    @Body() dto: Record<string, unknown>,
  ) {
    return this.svc.updateItem(user.companyId!, id, dto as never);
  }

  @Delete('items/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteItem(
    @CurrentUser() user: CurrentUserType,
    @Param('id') id: string,
  ): Promise<void> {
    await this.svc.deleteItem(user.companyId!, id);
  }

  // ── Kits ──────────────────────────────────────────────────────────────────

  @Get('kits')
  listKits(@CurrentUser() user: CurrentUserType) {
    return this.svc.listKits(user.companyId!);
  }

  @Post('kits')
  createKit(
    @CurrentUser() user: CurrentUserType,
    @Body() dto: Record<string, unknown>,
  ) {
    return this.svc.createKit(user.companyId!, dto as never);
  }

  @Put('kits/:id')
  updateKit(
    @CurrentUser() user: CurrentUserType,
    @Param('id') id: string,
    @Body() dto: Record<string, unknown>,
  ) {
    return this.svc.updateKit(user.companyId!, id, dto as never);
  }

  @Delete('kits/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteKit(
    @CurrentUser() user: CurrentUserType,
    @Param('id') id: string,
  ): Promise<void> {
    await this.svc.deleteKit(user.companyId!, id);
  }
}
