import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { SuppliersService } from './suppliers.service';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';
import { CurrentUser, type CurrentUserType } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller('suppliers')
export class SuppliersController {
  constructor(private readonly suppliersService: SuppliersService) {}

  @Post()
  @Roles('OWNER')
  create(@Body() dto: CreateSupplierDto, @CurrentUser() user: CurrentUserType) {
    return this.suppliersService.create(dto, user.companyId!);
  }

  @Get()
  findAll(
    @CurrentUser() user: CurrentUserType,
    @Query('archived') archived?: string,
  ) {
    if (!user.companyId) return [];
    return this.suppliersService.findAll(user.companyId, archived === 'true');
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: CurrentUserType) {
    if (!user.companyId) throw new NotFoundException('Supplier not found');
    return this.suppliersService.findOne(id, user.companyId);
  }

  @Patch(':id')
  @Roles('OWNER')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateSupplierDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.suppliersService.update(id, dto, user.companyId!);
  }

  @Patch(':id/archive')
  @Roles('OWNER')
  archive(@Param('id') id: string, @CurrentUser() user: CurrentUserType) {
    return this.suppliersService.archive(id, user.companyId!);
  }

  @Patch(':id/unarchive')
  @Roles('OWNER')
  unarchive(@Param('id') id: string, @CurrentUser() user: CurrentUserType) {
    return this.suppliersService.unarchive(id, user.companyId!);
  }

  @Delete(':id')
  @Roles('OWNER')
  @HttpCode(204)
  remove(@Param('id') id: string, @CurrentUser() user: CurrentUserType) {
    return this.suppliersService.remove(id, user.companyId!);
  }
}
