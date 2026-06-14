import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { calcCisDeduction, calcNetPayment, calcTaxMonth } from './cis.helpers';

@Injectable()
export class SubcontractorPaymentsService {
  constructor(private readonly prisma: PrismaService) {}

  list(
    companyId: string,
    filters?: { subcontractor_id?: string; tax_month?: string; job_id?: string },
  ) {
    const where: Record<string, unknown> = { company_id: companyId };
    if (filters?.subcontractor_id) where.subcontractor_id = filters.subcontractor_id;
    if (filters?.tax_month)        where.tax_month         = filters.tax_month;
    if (filters?.job_id)           where.job_id            = filters.job_id;

    return this.prisma.client.subcontractorPayment.findMany({
      where,
      include: {
        subcontractor: { select: { id: true, name: true, utr_number: true, deduction_rate: true } },
        job:           { select: { id: true, title: true } },
      },
      orderBy: { payment_date: 'desc' },
    });
  }

  async getOne(companyId: string, id: string) {
    const payment = await this.prisma.client.subcontractorPayment.findFirst({
      where:   { id, company_id: companyId },
      include: {
        subcontractor: { select: { id: true, name: true, utr_number: true, cis_status: true, deduction_rate: true } },
        job:           { select: { id: true, title: true } },
      },
    });
    if (!payment) throw new NotFoundException('Payment not found');
    return payment;
  }

  async create(
    companyId: string,
    dto: {
      subcontractor_id:        string;
      job_id?:                 string;
      payment_date:            string;
      labour_amount_pence:     number;
      materials_amount_pence?: number;
      vat_amount_pence?:       number;
      equipment_hire_pence?:   number;
      description?:            string;
      notes?:                  string;
      invoice_ref?:            string;
    },
  ) {
    const sub = await this.prisma.client.subcontractor.findFirst({
      where: { id: dto.subcontractor_id, company_id: companyId },
    });
    if (!sub) throw new NotFoundException('Subcontractor not found');

    if (!sub.utr_number) {
      throw new BadRequestException(
        'This subcontractor has no UTR number. Add their UTR before recording a CIS payment.',
      );
    }

    const materialsPence = dto.materials_amount_pence ?? 0;
    const vatPence       = dto.vat_amount_pence       ?? 0;
    const equipmentPence = dto.equipment_hire_pence   ?? 0;
    const grossPence     = dto.labour_amount_pence + materialsPence + vatPence + equipmentPence;
    const deductionPence = calcCisDeduction(dto.labour_amount_pence, sub.deduction_rate);
    const netPence       = calcNetPayment(dto.labour_amount_pence, materialsPence, vatPence, equipmentPence, deductionPence);

    const paymentDate = new Date(dto.payment_date);
    const taxMonth    = calcTaxMonth(paymentDate);

    return this.prisma.client.subcontractorPayment.create({
      data: {
        company_id:             companyId,
        subcontractor_id:       dto.subcontractor_id,
        job_id:                 dto.job_id             ?? null,
        payment_date:           paymentDate,
        tax_month:              taxMonth,
        gross_amount_pence:     grossPence,
        labour_amount_pence:    dto.labour_amount_pence,
        materials_amount_pence: materialsPence,
        vat_amount_pence:       vatPence,
        equipment_hire_pence:   equipmentPence,
        deduction_rate:         sub.deduction_rate,
        deduction_amount_pence: deductionPence,
        net_payment_pence:      netPence,
        description:            dto.description ?? null,
        notes:                  dto.notes       ?? null,
        invoice_ref:            dto.invoice_ref ?? null,
      },
      include: {
        subcontractor: { select: { id: true, name: true, utr_number: true } },
        job:           { select: { id: true, title: true } },
      },
    });
  }

  async update(
    companyId: string,
    id: string,
    dto: {
      payment_date?:           string;
      labour_amount_pence?:    number;
      materials_amount_pence?: number;
      vat_amount_pence?:       number;
      equipment_hire_pence?:   number;
      description?:            string | null;
      notes?:                  string | null;
      invoice_ref?:            string | null;
    },
  ) {
    const existing = await this.getOne(companyId, id);

    const labourPence    = dto.labour_amount_pence    ?? existing.labour_amount_pence;
    const materialsPence = dto.materials_amount_pence ?? existing.materials_amount_pence;
    const vatPence       = dto.vat_amount_pence       ?? existing.vat_amount_pence;
    const equipPence     = dto.equipment_hire_pence   ?? existing.equipment_hire_pence;
    const grossPence     = labourPence + materialsPence + vatPence + equipPence;
    const deductionPence = calcCisDeduction(labourPence, existing.deduction_rate);
    const netPence       = calcNetPayment(labourPence, materialsPence, vatPence, equipPence, deductionPence);

    const paymentDate = dto.payment_date ? new Date(dto.payment_date) : existing.payment_date;
    const taxMonth    = dto.payment_date ? calcTaxMonth(paymentDate) : existing.tax_month;

    return this.prisma.client.subcontractorPayment.update({
      where: { id },
      data: {
        payment_date:           paymentDate,
        tax_month:              taxMonth,
        gross_amount_pence:     grossPence,
        labour_amount_pence:    labourPence,
        materials_amount_pence: materialsPence,
        vat_amount_pence:       vatPence,
        equipment_hire_pence:   equipPence,
        deduction_amount_pence: deductionPence,
        net_payment_pence:      netPence,
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.notes       !== undefined && { notes:       dto.notes }),
        ...(dto.invoice_ref !== undefined && { invoice_ref: dto.invoice_ref }),
      },
      include: {
        subcontractor: { select: { id: true, name: true, utr_number: true } },
        job:           { select: { id: true, title: true } },
      },
    });
  }

  async remove(companyId: string, id: string): Promise<void> {
    await this.getOne(companyId, id);
    await this.prisma.client.subcontractorPayment.delete({ where: { id } });
  }

  previewCalculation(dto: {
    subcontractor_deduction_rate: number;
    payment_date:                 string;
    labour_amount_pence:          number;
    materials_amount_pence?:      number;
    vat_amount_pence?:            number;
    equipment_hire_pence?:        number;
  }) {
    const materialsPence = dto.materials_amount_pence ?? 0;
    const vatPence       = dto.vat_amount_pence       ?? 0;
    const equipPence     = dto.equipment_hire_pence   ?? 0;
    const grossPence     = dto.labour_amount_pence + materialsPence + vatPence + equipPence;
    const deductionPence = calcCisDeduction(dto.labour_amount_pence, dto.subcontractor_deduction_rate);
    const netPence       = grossPence - deductionPence;
    const taxMonth       = calcTaxMonth(new Date(dto.payment_date));

    return {
      gross_amount_pence:     grossPence,
      deduction_amount_pence: deductionPence,
      net_payment_pence:      netPence,
      tax_month:              taxMonth,
      deduction_rate:         dto.subcontractor_deduction_rate,
    };
  }
}
