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
  Query,
  Res,
} from '@nestjs/common';
import { QuotesService } from './quotes.service';
import { CreateQuoteDto } from './dto/create-quote.dto';
import { UpdateQuoteDto } from './dto/update-quote.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { CurrentUserType } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { Public } from '../auth/decorators/public.decorator';

@Controller('quotes')
export class QuotesController {
  constructor(private readonly quotesService: QuotesService) {}

  // ── Public routes (no auth) — MUST be before :id routes ──────────────────

  @Get('public/:token')
  @Public()
  getPublic(@Param('token') token: string) {
    return this.quotesService.getPublicByToken(token);
  }

  @Post('public/:token/accept')
  @Public()
  @HttpCode(HttpStatus.OK)
  acceptPublic(@Param('token') token: string) {
    return this.quotesService.acceptByToken(token);
  }

  @Post('public/:token/reject')
  @Public()
  @HttpCode(HttpStatus.OK)
  rejectPublic(
    @Param('token') token: string,
    @Body() body: { reason?: string },
  ) {
    return this.quotesService.rejectByToken(token, body.reason);
  }

  // ── Protected routes (OWNER only) ─────────────────────────────────────────

  @Get()
  @Roles('OWNER')
  list(
    @CurrentUser() user: CurrentUserType,
    @Query('status') status?: string,
    @Query('search') search?: string,
  ) {
    return this.quotesService.list(user.companyId!, { status, search });
  }

  @Post()
  @Roles('OWNER')
  create(
    @CurrentUser() user: CurrentUserType,
    @Body() dto: CreateQuoteDto,
  ) {
    return this.quotesService.create(user.companyId!, dto);
  }

  @Get(':id')
  @Roles('OWNER')
  getOne(
    @CurrentUser() user: CurrentUserType,
    @Param('id') id: string,
  ) {
    return this.quotesService.getOne(user.companyId!, id);
  }

  @Patch(':id')
  @Roles('OWNER')
  update(
    @CurrentUser() user: CurrentUserType,
    @Param('id') id: string,
    @Body() dto: UpdateQuoteDto,
  ) {
    return this.quotesService.update(user.companyId!, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles('OWNER')
  async remove(
    @CurrentUser() user: CurrentUserType,
    @Param('id') id: string,
  ): Promise<void> {
    await this.quotesService.remove(user.companyId!, id);
  }

  @Get(':id/pdf')
  @Roles('OWNER')
  async getPdf(
    @CurrentUser() user: CurrentUserType,
    @Param('id') id: string,
    @Res() res: { setHeader(n: string, v: string): void; end(b: Buffer): void },
  ): Promise<void> {
    const buffer = await this.quotesService.generatePdf(user.companyId!, id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="quote-${id}.pdf"`);
    res.setHeader('Content-Length', String(buffer.length));
    res.end(buffer);
  }

  @Post(':id/email')
  @Roles('OWNER')
  sendEmail(
    @CurrentUser() user: CurrentUserType,
    @Param('id') id: string,
  ) {
    return this.quotesService.sendEmail(user.companyId!, id);
  }

  @Patch(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @Roles('OWNER')
  cancel(
    @CurrentUser() user: CurrentUserType,
    @Param('id') id: string,
  ) {
    return this.quotesService.cancel(user.companyId!, id);
  }
}
