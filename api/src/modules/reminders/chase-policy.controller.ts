import {
  Body,
  Controller,
  Get,
  Put,
  Post,
  Query,
  Logger,
} from '@nestjs/common';
import {
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  Max,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser, type CurrentUserType } from '../auth/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { AutoChaseService } from './auto-chase.service';
import { chaseGentleHtml } from './templates/chase-gentle.email';
import { chaseFirmHtml } from './templates/chase-firm.email';
import { chaseFinalHtml } from './templates/chase-final.email';

class UpdateChasePolicyDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(90)
  @Type(() => Number)
  gentle_days?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(90)
  @Type(() => Number)
  firm_days?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(90)
  @Type(() => Number)
  final_days?: number;

  @IsOptional()
  @IsBoolean()
  interest_enabled?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  @Type(() => Number)
  interest_rate_pct?: number;

  @IsOptional()
  @IsInt()
  @Min(7)
  @Max(18)
  @Type(() => Number)
  send_hour?: number;
}

@Controller('api/chase-policy')
@Roles('OWNER')
export class ChasePolicyController {
  private readonly logger = new Logger(ChasePolicyController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly autoChase: AutoChaseService,
  ) {}

  // GET /api/chase-policy — get current policy (creates default if absent)
  @Get()
  async getPolicy(@CurrentUser() user: CurrentUserType) {
    const companyId = user.companyId!;

    return this.prisma.client.chasePolicy.upsert({
      where: { company_id: companyId },
      create: { company_id: companyId },
      update: {},
    });
  }

  // PUT /api/chase-policy — update policy
  @Put()
  async updatePolicy(
    @CurrentUser() user: CurrentUserType,
    @Body() dto: UpdateChasePolicyDto,
  ) {
    const companyId = user.companyId!;

    const { gentle_days, firm_days, final_days } = dto;
    if (gentle_days !== undefined && firm_days !== undefined && gentle_days >= firm_days) {
      throw new Error('gentle_days must be less than firm_days');
    }
    if (firm_days !== undefined && final_days !== undefined && firm_days >= final_days) {
      throw new Error('firm_days must be less than final_days');
    }

    return this.prisma.client.chasePolicy.upsert({
      where: { company_id: companyId },
      create: { company_id: companyId, ...dto },
      update: dto,
    });
  }

  // GET /api/chase-policy/activity — recent chase activity feed
  @Get('activity')
  async getActivity(
    @CurrentUser() user: CurrentUserType,
    @Query('days') daysStr?: string,
  ) {
    const companyId = user.companyId!;
    const days = parseInt(daysStr ?? '30', 10);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const [activity, recovered] = await Promise.all([
      this.prisma.client.chaseActivity.findMany({
        where: { company_id: companyId, created_at: { gte: since } },
        include: {
          invoice: { select: { invoice_number: true, amount_due_pence: true, status: true } },
          customer: { select: { name: true } },
        },
        orderBy: { created_at: 'desc' },
        take: 50,
      }),
      this.prisma.client.invoice.findMany({
        where: {
          company_id: companyId,
          status: 'PAID',
          chaseActivities: { some: { created_at: { gte: since } } },
        },
        select: { amount_due_pence: true, invoice_number: true },
      }),
    ]);

    const recoveredTotal = recovered.reduce((s, i) => s + i.amount_due_pence, 0);

    return { activity, recoveredCount: recovered.length, recoveredTotalPence: recoveredTotal };
  }

  // POST /api/chase-policy/preview — renders the actual HTML for all 3 stages
  @Post('preview')
  async preview(@CurrentUser() user: CurrentUserType) {
    const companyId = user.companyId!;

    const company = await this.prisma.client.company.findUnique({
      where: { id: companyId },
      select: {
        name: true,
        logo_url: true,
        chasePolicy: { select: { firm_days: true, final_days: true, interest_enabled: true, interest_rate_pct: true } },
      },
    });

    // Resolve reply-to email from owner user (Company has no email field)
    const owner = await this.prisma.client.user.findFirst({
      where: { companyId, role: 'OWNER' },
      select: { email: true },
    });
    const companyEmail = owner?.email ?? 'info@example.co.uk';

    const sampleData = {
      customerName: 'James Fletcher',
      companyName: company?.name ?? 'Bloggs Plumbing',
      companyEmail,
      invoiceNumber: 'INV-042',
      amountDuePence: 64000,            // £640.00
      dueDateStr: '15 May 2026',
      paymentLink: '#',
      logoUrl: company?.logo_url ?? null,
    };

    const policy = company?.chasePolicy;

    return {
      gentle: chaseGentleHtml(sampleData),
      firm: chaseFirmHtml({ ...sampleData, daysOverdue: policy?.firm_days ?? 10 }),
      final: chaseFinalHtml({
        ...sampleData,
        daysOverdue: policy?.final_days ?? 21,
        interestEnabled: policy?.interest_enabled ?? false,
        isBusiness: true,
        interestRatePct: policy?.interest_rate_pct ?? 12.5,
        interestPounds:
          policy?.interest_enabled
            ? parseFloat((640 * 0.125 * ((policy.final_days ?? 21) / 365)).toFixed(2))
            : null,
      }),
    };
  }

  // POST /api/chase-policy/trigger — manual run (testing)
  @Post('trigger')
  async trigger(@CurrentUser() user: CurrentUserType) {
    const result = await this.autoChase.triggerForCompany(user.companyId!);
    return result;
  }
}
