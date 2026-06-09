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
import { GasCertificatesService } from './gas-certificates.service';
import { CreateGasCertDto } from './dto/create-gas-cert.dto';
import { UpdateGasCertDto } from './dto/update-gas-cert.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { CurrentUserType } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller('gas-certificates')
export class GasCertificatesController {
  constructor(private readonly service: GasCertificatesService) {}

  /** List certs. Engineers see only certs for their assigned jobs/certs. */
  @Get()
  list(
    @CurrentUser() user: CurrentUserType,
    @Query('cert_type') certType?: string,
    @Query('status') status?: string,
    @Query('search') search?: string,
  ) {
    return this.service.list(
      user.companyId!,
      user.id,
      user.role,
      { cert_type: certType, status, search },
    );
  }

  /** Create — both roles. Engineers restricted to their assigned jobs in service. */
  @Post()
  create(
    @CurrentUser() user: CurrentUserType,
    @Body() dto: CreateGasCertDto,
  ) {
    return this.service.create(user.companyId!, user.id, user.role, dto);
  }

  /** Get one — both roles. Service enforces engineer access. */
  @Get(':id')
  getOne(
    @CurrentUser() user: CurrentUserType,
    @Param('id') id: string,
  ) {
    return this.service.getOne(user.companyId!, id, user.id, user.role);
  }

  /** Update — both roles. Service enforces engineer access. */
  @Patch(':id')
  update(
    @CurrentUser() user: CurrentUserType,
    @Param('id') id: string,
    @Body() dto: UpdateGasCertDto,
  ) {
    return this.service.update(user.companyId!, id, user.id, user.role, dto);
  }

  /** Mark complete — both roles. */
  @Patch(':id/complete')
  @HttpCode(HttpStatus.OK)
  markComplete(
    @CurrentUser() user: CurrentUserType,
    @Param('id') id: string,
  ) {
    return this.service.markComplete(user.companyId!, id, user.id, user.role);
  }

  /** Delete — OWNER only. */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles('OWNER')
  async remove(
    @CurrentUser() user: CurrentUserType,
    @Param('id') id: string,
  ): Promise<void> {
    await this.service.remove(user.companyId!, id);
  }

  /** PDF download — both roles. Service enforces engineer access. */
  @Get(':id/pdf')
  async getPdf(
    @CurrentUser() user: CurrentUserType,
    @Param('id') id: string,
    @Res() res: { setHeader(n: string, v: string): void; end(b: Buffer): void },
  ): Promise<void> {
    const buffer = await this.service.generatePdf(
      user.companyId!,
      id,
      user.id,
      user.role,
    );
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${id}.pdf"`);
    res.setHeader('Content-Length', String(buffer.length));
    res.end(buffer);
  }

  /** Email — both roles. Service enforces engineer access. */
  @Post(':id/email')
  sendEmail(
    @CurrentUser() user: CurrentUserType,
    @Param('id') id: string,
  ) {
    return this.service.sendEmail(user.companyId!, id, user.id, user.role);
  }
}
