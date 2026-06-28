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
} from '@nestjs/common';
import { RecurringInvoicesService } from './recurring-invoices.service';
import { CreateRecurringInvoiceDto } from './dto/create-recurring-invoice.dto';
import { UpdateRecurringInvoiceDto } from './dto/update-recurring-invoice.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { CurrentUserType } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller('recurring-invoices')
@Roles('OWNER')
export class RecurringInvoicesController {
  constructor(private readonly svc: RecurringInvoicesService) {}

  @Get()
  list(@CurrentUser() user: CurrentUserType) {
    return this.svc.list(user.companyId!);
  }

  @Post()
  create(
    @CurrentUser() user: CurrentUserType,
    @Body() dto: CreateRecurringInvoiceDto,
  ) {
    return this.svc.create(user.companyId!, dto);
  }

  @Get(':id')
  getOne(@CurrentUser() user: CurrentUserType, @Param('id') id: string) {
    return this.svc.getOne(user.companyId!, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: CurrentUserType,
    @Param('id') id: string,
    @Body() dto: UpdateRecurringInvoiceDto,
  ) {
    return this.svc.update(user.companyId!, id, dto);
  }

  @Post(':id/pause')
  @HttpCode(HttpStatus.OK)
  pause(@CurrentUser() user: CurrentUserType, @Param('id') id: string) {
    return this.svc.pause(user.companyId!, id);
  }

  @Post(':id/activate')
  @HttpCode(HttpStatus.OK)
  activate(@CurrentUser() user: CurrentUserType, @Param('id') id: string) {
    return this.svc.activate(user.companyId!, id);
  }

  @Post(':id/generate-now')
  @HttpCode(HttpStatus.OK)
  generateNow(@CurrentUser() user: CurrentUserType, @Param('id') id: string) {
    return this.svc.generateNow(user.companyId!, id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentUser() user: CurrentUserType,
    @Param('id') id: string,
  ): Promise<void> {
    await this.svc.remove(user.companyId!, id);
  }
}
