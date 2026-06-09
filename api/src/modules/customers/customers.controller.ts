import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { CustomersService } from './customers.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { CurrentUserType } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller('customers')
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  /** Owner creates a new customer in the company. */
  @Post()
  @Roles('OWNER')
  create(@Body() dto: CreateCustomerDto, @CurrentUser() user: CurrentUserType) {
    return this.customersService.create(dto, user.companyId!);
  }

  /** List all customers in the company. Both roles. */
  @Get()
  findAll(@CurrentUser() user: CurrentUserType) {
    if (!user.companyId) return [];
    return this.customersService.findAll(user.companyId);
  }

  /** Get a single customer by ID. Both roles. */
  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: CurrentUserType) {
    if (!user.companyId) throw new NotFoundException('Customer not found');
    return this.customersService.findOne(id, user.companyId);
  }

  /** Update a customer. Owner only. */
  @Patch(':id')
  @Roles('OWNER')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateCustomerDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.customersService.update(id, dto, user.companyId!);
  }

  /**
   * Delete a customer. Owner only.
   * Returns 409 if the customer has existing jobs.
   */
  @Delete(':id')
  @Roles('OWNER')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string, @CurrentUser() user: CurrentUserType) {
    return this.customersService.remove(id, user.companyId!);
  }
}
