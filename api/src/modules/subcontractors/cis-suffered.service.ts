import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { calcTaxMonth } from './cis.helpers';

@Injectable()
export class CisSufferedService {
  constructor(private readonly prisma: PrismaService) {}

  list(companyId: string, taxMonth?: string) {
    return this.prisma.client.cisSufferedDeduction.findMany({
      where:   { company_id: companyId, ...(taxMonth ? { tax_month: taxMonth } : {}) },
      orderBy: { payment_date: 'desc' },
    });
  }

  create(
    companyId: string,
    dto: {
      contractor_name:        string;
      contractor_utr?:        string;
      gross_amount_pence:     number;
      deduction_amount_pence: number;
      payment_date:           string;
      invoice_ref?:           string;
      notes?:                 string;
    },
  ) {
    const paymentDate = new Date(dto.payment_date);
    const taxMonth    = calcTaxMonth(paymentDate);
    const netReceived = dto.gross_amount_pence - dto.deduction_amount_pence;

    return this.prisma.client.cisSufferedDeduction.create({
      data: {
        company_id:             companyId,
        contractor_name:        dto.contractor_name,
        contractor_utr:         dto.contractor_utr        ?? null,
        gross_amount_pence:     dto.gross_amount_pence,
        deduction_amount_pence: dto.deduction_amount_pence,
        net_received_pence:     netReceived,
        payment_date:           paymentDate,
        tax_month:              taxMonth,
        invoice_ref:            dto.invoice_ref           ?? null,
        notes:                  dto.notes                 ?? null,
      },
    });
  }

  async remove(companyId: string, id: string): Promise<void> {
    const record = await this.prisma.client.cisSufferedDeduction.findFirst({
      where: { id, company_id: companyId },
    });
    if (!record) throw new NotFoundException('Record not found');
    await this.prisma.client.cisSufferedDeduction.delete({ where: { id } });
  }
}
