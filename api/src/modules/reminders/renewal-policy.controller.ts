import { Body, Controller, Get, Put, Post } from '@nestjs/common';
import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser, type CurrentUserType } from '../auth/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { RenewalAutopilotService } from './renewal-autopilot.service';

class UpdateRenewalPolicyDto {
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsInt() @Min(7) @Max(180) @Type(() => Number) days_before?: number;
  @IsOptional() @IsBoolean() create_todo?: boolean;
  @IsOptional() @IsInt() @Min(7) @Max(18) @Type(() => Number) send_hour?: number;
}

@Controller('api/renewal-policy')
@Roles('OWNER')
export class RenewalPolicyController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly renewal: RenewalAutopilotService,
  ) {}

  @Get()
  async getPolicy(@CurrentUser() user: CurrentUserType) {
    return this.prisma.client.renewalPolicy.upsert({
      where: { company_id: user.companyId! },
      create: { company_id: user.companyId! },
      update: {},
    });
  }

  @Put()
  async updatePolicy(
    @CurrentUser() user: CurrentUserType,
    @Body() dto: UpdateRenewalPolicyDto,
  ) {
    return this.prisma.client.renewalPolicy.upsert({
      where: { company_id: user.companyId! },
      create: { company_id: user.companyId!, ...dto },
      update: dto,
    });
  }

  @Post('trigger')
  async trigger(@CurrentUser() user: CurrentUserType) {
    return this.renewal.triggerForCompany(user.companyId!);
  }
}
