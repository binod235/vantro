import { Body, Controller, Get, Put, Post } from '@nestjs/common';
import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser, type CurrentUserType } from '../auth/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { QuoteChaseService } from './quote-chase.service';

class UpdateQuoteChasePolicyDto {
  @IsOptional() @IsBoolean() enabled?: boolean;

  @IsOptional() @IsInt() @Min(1) @Max(90) @Type(() => Number) first_days?: number;
  @IsOptional() @IsInt() @Min(1) @Max(90) @Type(() => Number) second_days?: number;
  @IsOptional() @IsInt() @Min(1) @Max(90) @Type(() => Number) final_days?: number;

  @IsOptional() @IsInt() @Min(7) @Max(18) @Type(() => Number) send_hour?: number;
}

@Controller('api/quote-chase-policy')
@Roles('OWNER')
export class QuoteChasePolicyController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly quoteChase: QuoteChaseService,
  ) {}

  @Get()
  async getPolicy(@CurrentUser() user: CurrentUserType) {
    return this.prisma.client.quoteChasePolicy.upsert({
      where: { company_id: user.companyId! },
      create: { company_id: user.companyId! },
      update: {},
    });
  }

  @Put()
  async updatePolicy(
    @CurrentUser() user: CurrentUserType,
    @Body() dto: UpdateQuoteChasePolicyDto,
  ) {
    const { first_days, second_days, final_days } = dto;
    if (first_days !== undefined && second_days !== undefined && first_days >= second_days) {
      throw new Error('first_days must be less than second_days');
    }
    if (second_days !== undefined && final_days !== undefined && second_days >= final_days) {
      throw new Error('second_days must be less than final_days');
    }

    return this.prisma.client.quoteChasePolicy.upsert({
      where: { company_id: user.companyId! },
      create: { company_id: user.companyId!, ...dto },
      update: dto,
    });
  }

  @Post('trigger')
  async trigger(@CurrentUser() user: CurrentUserType) {
    return this.quoteChase.triggerForCompany(user.companyId!);
  }
}
