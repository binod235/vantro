import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { CreateSubcontractorDto } from './dto/create-subcontractor.dto';
import type { UpdateSubcontractorDto } from './dto/update-subcontractor.dto';
import type { VerifySubcontractorDto } from './dto/verify-subcontractor.dto';

const CIS_RATES: Record<string, number> = {
  GROSS:    0,
  STANDARD: 20,
  HIGHER:   30,
};

@Injectable()
export class SubcontractorsService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(companyId: string, includeInactive = false) {
    return this.prisma.client.subcontractor.findMany({
      where:   { company_id: companyId, ...(includeInactive ? {} : { is_active: true }) },
      orderBy: { name: 'asc' },
    });
  }

  async findOne(companyId: string, id: string) {
    const sub = await this.prisma.client.subcontractor.findFirst({
      where:   { id, company_id: companyId },
      include: {
        payments: {
          orderBy: { payment_date: 'desc' },
          take: 10,
        },
      },
    });
    if (!sub) throw new NotFoundException('Subcontractor not found');
    return sub;
  }

  create(companyId: string, dto: CreateSubcontractorDto) {
    // HMRC's rule: an unverified subcontractor is always Higher rate (30%).
    // CIS status is never settable at creation — only via the Verify action.
    return this.prisma.client.subcontractor.create({
      data: {
        company_id:          companyId,
        name:                dto.name,
        email:               dto.email               ?? null,
        phone:               dto.phone               ?? null,
        address:             dto.address             ?? null,
        utr_number:          dto.utr_number          ?? null,
        ni_number:           dto.ni_number           ?? null,
        company_reg_number:  dto.company_reg_number  ?? null,
        subcontractor_type:  dto.subcontractor_type  ?? 'SOLE_TRADER',
        cis_status:          'HIGHER',
        deduction_rate:      CIS_RATES.HIGHER,
        is_cis_verified:     false,
        notes:               dto.notes               ?? null,
      },
    });
  }

  async update(companyId: string, id: string, dto: UpdateSubcontractorDto) {
    await this.findOne(companyId, id);

    return this.prisma.client.subcontractor.update({
      where: { id },
      data: {
        ...(dto.name               !== undefined && { name:               dto.name }),
        ...(dto.email              !== undefined && { email:              dto.email }),
        ...(dto.phone              !== undefined && { phone:              dto.phone }),
        ...(dto.address            !== undefined && { address:            dto.address }),
        ...(dto.utr_number         !== undefined && { utr_number:         dto.utr_number }),
        ...(dto.ni_number          !== undefined && { ni_number:          dto.ni_number }),
        ...(dto.company_reg_number !== undefined && { company_reg_number: dto.company_reg_number }),
        ...(dto.subcontractor_type !== undefined && { subcontractor_type: dto.subcontractor_type }),
        ...(dto.notes              !== undefined && { notes:              dto.notes }),
        ...(dto.is_active          !== undefined && { is_active:          dto.is_active }),
      },
    });
  }

  async recordVerification(companyId: string, id: string, userId: string, dto: VerifySubcontractorDto) {
    await this.findOne(companyId, id);
    return this.prisma.client.subcontractor.update({
      where: { id },
      data: {
        cis_status:          dto.cis_status,
        deduction_rate:      CIS_RATES[dto.cis_status],
        is_cis_verified:     dto.cis_status !== 'HIGHER',
        verification_number: dto.verification_number,
        verification_date:   new Date(dto.verification_date),
        verified_by_user_id: userId,
      },
    });
  }

  async remove(companyId: string, id: string): Promise<void> {
    await this.findOne(companyId, id);
    await this.prisma.client.subcontractor.update({
      where: { id },
      data:  { is_active: false },
    });
  }
}
