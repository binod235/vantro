import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { EnquiryStatus } from '@prisma/client';
import { Webhook } from 'svix';
import { EnquiriesService } from './enquiries.service';
import { CreateEnquiryDto } from './dto/create-enquiry.dto';
import { UpdateEnquiryDto } from './dto/update-enquiry.dto';
import { UpdateEnquiryStatusDto } from './dto/update-status.dto';
import { ConvertEnquiryDto } from './dto/convert-enquiry.dto';
import { IntakeEnquiryDto } from './dto/intake-enquiry.dto';
import {
  CurrentUser,
  type CurrentUserType,
} from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { Public } from '../auth/decorators/public.decorator';

@Controller('enquiries')
export class EnquiriesController {
  constructor(private readonly enquiriesService: EnquiriesService) {}

  @Post('intake/:slug')
  @Public()
  @HttpCode(201)
  async intake(
    @Param('slug') slug: string,
    @Body() dto: IntakeEnquiryDto,
  ) {
    await this.enquiriesService.createFromIntake(slug, dto.name, dto.phone, dto.email, dto.message);
    return { message: 'Enquiry received' };
  }

  @Post('email-webhook')
  @Public()
  @HttpCode(200)
  async emailWebhook(
    @Req() req: { rawBody?: Buffer; body: unknown },
    @Headers('svix-id') svixId: string,
    @Headers('svix-timestamp') svixTimestamp: string,
    @Headers('svix-signature') svixSignature: string,
  ) {
    const secret = process.env.RESEND_WEBHOOK_SECRET;
    if (!secret) return { received: true };

    const wh = new Webhook(secret);
    let payload: Record<string, unknown>;
    try {
      const raw = req.rawBody ?? Buffer.from(JSON.stringify(req.body));
      payload = wh.verify(raw, {
        'svix-id': svixId ?? '',
        'svix-timestamp': svixTimestamp ?? '',
        'svix-signature': svixSignature ?? '',
      }) as Record<string, unknown>;
    } catch {
      throw new BadRequestException('Invalid webhook signature');
    }

    const inboundEmail = payload as {
      data?: {
        from?: string;
        to?: string[];
        subject?: string;
      };
    };

    const from = inboundEmail.data?.from ?? '';
    const toAddresses = inboundEmail.data?.to ?? [];
    const subject = inboundEmail.data?.subject ?? '';

    const nameMatch = from.match(/^"?([^"<]+)"?\s*</);
    const senderName = nameMatch ? nameMatch[1].trim() : from;
    const emailMatch = from.match(/<([^>]+)>/);
    const senderEmail = emailMatch ? emailMatch[1] : from;

    const inboundDomain = process.env.INBOUND_EMAIL_DOMAIN ?? 'vantro.co.uk';
    let slug: string | null = null;
    for (const addr of toAddresses) {
      const m = addr.match(/enquiries\+([^@]+)@/);
      if (m && addr.includes(inboundDomain)) {
        slug = m[1];
        break;
      }
    }

    if (slug) {
      await this.enquiriesService.createFromEmailWebhook(slug, senderName, senderEmail, subject);
    }

    return { received: true };
  }

  @Post()
  @Roles('OWNER')
  create(@Body() dto: CreateEnquiryDto, @CurrentUser() user: CurrentUserType) {
    return this.enquiriesService.create(dto, user.companyId!);
  }

  @Get()
  findAll(
    @CurrentUser() user: CurrentUserType,
    @Query('status') status?: string,
  ) {
    if (!user.companyId) return [];
    const isOwner = user.role === 'OWNER';
    const parsedStatus =
      status && Object.values(EnquiryStatus).includes(status as EnquiryStatus)
        ? (status as EnquiryStatus)
        : undefined;
    return this.enquiriesService.findAll(user.companyId, user.id, isOwner, parsedStatus);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: CurrentUserType) {
    if (!user.companyId) throw new NotFoundException('Enquiry not found');
    const isOwner = user.role === 'OWNER';
    return this.enquiriesService.findOne(id, user.companyId, user.id, isOwner);
  }

  @Patch(':id')
  @Roles('OWNER')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateEnquiryDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.enquiriesService.update(id, dto, user.companyId!);
  }

  @Patch(':id/status')
  @Roles('OWNER')
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateEnquiryStatusDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.enquiriesService.updateStatus(id, dto.status, user.companyId!);
  }

  @Post(':id/convert')
  @Roles('OWNER')
  convertToJob(
    @Param('id') id: string,
    @Body() dto: ConvertEnquiryDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.enquiriesService.convertToJob(id, dto, user.companyId!);
  }

  @Delete(':id')
  @Roles('OWNER')
  @HttpCode(204)
  remove(@Param('id') id: string, @CurrentUser() user: CurrentUserType) {
    return this.enquiriesService.remove(id, user.companyId!);
  }
}
