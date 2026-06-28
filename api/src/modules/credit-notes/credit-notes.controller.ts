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
import { CreditNotesService } from './credit-notes.service';
import { CreateCreditNoteDto } from './dto/create-credit-note.dto';
import { UpdateCreditNoteDto } from './dto/update-credit-note.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { CurrentUserType } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller('credit-notes')
@Roles('OWNER')
export class CreditNotesController {
  constructor(private readonly creditNotesService: CreditNotesService) {}

  // ── GET /credit-notes?status=ISSUED&customer_id=...&search=CN-001 ─────────
  @Get()
  list(
    @CurrentUser() user: CurrentUserType,
    @Query('status') status?: string,
    @Query('customer_id') customer_id?: string,
    @Query('search') search?: string,
  ) {
    return this.creditNotesService.list(user.companyId!, { status, customer_id, search });
  }

  // ── POST /credit-notes ──────────────────────────────────────────────────
  @Post()
  create(
    @CurrentUser() user: CurrentUserType,
    @Body() dto: CreateCreditNoteDto,
  ) {
    return this.creditNotesService.create(user.companyId!, dto);
  }

  // ── GET /credit-notes/:id ───────────────────────────────────────────────
  @Get(':id')
  getOne(
    @CurrentUser() user: CurrentUserType,
    @Param('id') id: string,
  ) {
    return this.creditNotesService.getOne(user.companyId!, id);
  }

  // ── PUT /credit-notes/:id ───────────────────────────────────────────────
  @Patch(':id')
  update(
    @CurrentUser() user: CurrentUserType,
    @Param('id') id: string,
    @Body() dto: UpdateCreditNoteDto,
  ) {
    return this.creditNotesService.update(user.companyId!, id, dto);
  }

  // ── POST /credit-notes/:id/issue ────────────────────────────────────────
  @Post(':id/issue')
  @HttpCode(HttpStatus.OK)
  issue(
    @CurrentUser() user: CurrentUserType,
    @Param('id') id: string,
  ) {
    return this.creditNotesService.issue(user.companyId!, id);
  }

  // ── POST /credit-notes/:id/void ─────────────────────────────────────────
  @Post(':id/void')
  @HttpCode(HttpStatus.OK)
  void_(
    @CurrentUser() user: CurrentUserType,
    @Param('id') id: string,
  ) {
    return this.creditNotesService.void(user.companyId!, id);
  }

  // ── DELETE /credit-notes/:id ────────────────────────────────────────────
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentUser() user: CurrentUserType,
    @Param('id') id: string,
  ): Promise<void> {
    await this.creditNotesService.remove(user.companyId!, id);
  }

  // ── GET /credit-notes/:id/pdf ────────────────────────────────────────────
  @Get(':id/pdf')
  async getPdf(
    @CurrentUser() user: CurrentUserType,
    @Param('id') id: string,
    @Res() res: {
      setHeader(name: string, value: string): void;
      end(body: Buffer): void;
    },
  ): Promise<void> {
    const buffer = await this.creditNotesService.generatePdf(user.companyId!, id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="credit-note-${id}.pdf"`);
    res.setHeader('Content-Length', String(buffer.length));
    res.end(buffer);
  }

  // ── POST /credit-notes/:id/email ────────────────────────────────────────
  @Post(':id/email')
  emailCreditNote(
    @CurrentUser() user: CurrentUserType,
    @Param('id') id: string,
  ) {
    return this.creditNotesService.emailCreditNote(user.companyId!, id);
  }
}
