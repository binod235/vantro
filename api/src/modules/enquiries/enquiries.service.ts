import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EnquiryStatus, IntakeMethod } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { CreateEnquiryDto } from './dto/create-enquiry.dto';
import type { UpdateEnquiryDto } from './dto/update-enquiry.dto';
import type { ConvertEnquiryDto } from './dto/convert-enquiry.dto';

const ENQUIRY_INCLUDE = {
  assigned_to: { select: { id: true, name: true } },
  customer: { select: { id: true, name: true } },
} as const;

@Injectable()
export class EnquiriesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateEnquiryDto, companyId: string) {
    return this.prisma.client.$transaction(async (tx) => {
      const agg = await tx.enquiry.aggregate({
        where: { company_id: companyId },
        _max: { enquiry_no: true },
      });
      const nextNo = (agg._max.enquiry_no ?? 0) + 1;

      return tx.enquiry.create({
        data: {
          ...dto,
          enquiry_no: nextNo,
          company_id: companyId,
          received_date: dto.received_date ? new Date(dto.received_date) : undefined,
        },
        include: ENQUIRY_INCLUDE,
      });
    });
  }

  findAll(companyId: string, callerId: string, isOwner: boolean, status?: EnquiryStatus) {
    const where = {
      company_id: companyId,
      ...(status ? { status } : {}),
      ...(!isOwner ? { assigned_to_id: callerId } : {}),
    };

    return this.prisma.client.enquiry.findMany({
      where,
      include: ENQUIRY_INCLUDE,
      orderBy: { enquiry_no: 'desc' },
    });
  }

  async findOne(id: string, companyId: string, callerId: string, isOwner: boolean) {
    const where = isOwner
      ? { id, company_id: companyId }
      : { id, company_id: companyId, assigned_to_id: callerId };

    const enquiry = await this.prisma.client.enquiry.findFirst({
      where,
      include: ENQUIRY_INCLUDE,
    });
    if (!enquiry) throw new NotFoundException('Enquiry not found');
    return enquiry;
  }

  async update(id: string, dto: UpdateEnquiryDto, companyId: string) {
    await this.findOneOwner(id, companyId);
    return this.prisma.client.enquiry.update({
      where: { id },
      data: {
        ...dto,
        received_date: dto.received_date ? new Date(dto.received_date) : undefined,
      },
      include: ENQUIRY_INCLUDE,
    });
  }

  async updateStatus(id: string, status: EnquiryStatus, companyId: string) {
    await this.findOneOwner(id, companyId);
    return this.prisma.client.enquiry.update({
      where: { id },
      data: { status },
      include: ENQUIRY_INCLUDE,
    });
  }

  async remove(id: string, companyId: string) {
    const enquiry = await this.findOneOwner(id, companyId);
    if (enquiry.status === 'CONVERTED') {
      throw new ConflictException('Cannot delete a converted enquiry');
    }
    await this.prisma.client.enquiry.delete({ where: { id } });
  }

  async convertToJob(id: string, dto: ConvertEnquiryDto, companyId: string) {
    const enquiry = await this.findOneOwner(id, companyId);

    if (enquiry.status === 'CONVERTED') {
      throw new ConflictException('Enquiry has already been converted to a job');
    }

    return this.prisma.client.$transaction(async (tx) => {
      // Resolve or create customer
      let customerId = enquiry.customer_id;

      if (!customerId) {
        const customer = await tx.customer.create({
          data: {
            company_id: companyId,
            name: enquiry.name,
            email: enquiry.email ?? undefined,
            phone: enquiry.phone ?? undefined,
            address_line1: enquiry.address_line1 ?? undefined,
            address_line2: enquiry.address_line2 ?? undefined,
            city: enquiry.city ?? undefined,
            postcode: enquiry.postcode ?? undefined,
          },
        });
        customerId = customer.id;
      }

      const job = await tx.job.create({
        data: {
          company_id: companyId,
          customer_id: customerId,
          engineer_id: dto.engineer_id ?? null,
          title: enquiry.name,
          description: enquiry.notes ?? null,
          status: 'QUOTED',
          scheduled_at: dto.scheduled_at ? new Date(dto.scheduled_at) : null,
        },
      });

      await tx.enquiry.update({
        where: { id },
        data: {
          status: EnquiryStatus.CONVERTED,
          converted_job_id: job.id,
          converted_at: new Date(),
        },
      });

      return job;
    });
  }

  async createFromIntake(slug: string, name: string, phone?: string, email?: string, notes?: string) {
    const company = await this.prisma.client.company.findUnique({
      where: { slug },
      select: { id: true },
    });
    if (!company) throw new NotFoundException('Company not found');

    return this.prisma.client.$transaction(async (tx) => {
      const agg = await tx.enquiry.aggregate({
        where: { company_id: company.id },
        _max: { enquiry_no: true },
      });
      const nextNo = (agg._max.enquiry_no ?? 0) + 1;

      await tx.enquiry.create({
        data: {
          company_id: company.id,
          enquiry_no: nextNo,
          name,
          phone: phone ?? null,
          email: email ?? null,
          notes: notes ?? null,
          intake_method: IntakeMethod.DIRECT_LINK,
          source: 'OTHER',
        },
      });
    });
  }

  async createFromEmailWebhook(
    slug: string,
    senderName: string,
    senderEmail: string,
    notes: string,
  ) {
    const company = await this.prisma.client.company.findUnique({
      where: { slug },
      select: { id: true },
    });
    if (!company) return;

    return this.prisma.client.$transaction(async (tx) => {
      const agg = await tx.enquiry.aggregate({
        where: { company_id: company.id },
        _max: { enquiry_no: true },
      });
      const nextNo = (agg._max.enquiry_no ?? 0) + 1;

      await tx.enquiry.create({
        data: {
          company_id: company.id,
          enquiry_no: nextNo,
          name: senderName || senderEmail,
          email: senderEmail,
          notes,
          intake_method: IntakeMethod.EMAIL,
          source: 'EMAIL',
        },
      });
    });
  }

  private async findOneOwner(id: string, companyId: string) {
    const enquiry = await this.prisma.client.enquiry.findFirst({
      where: { id, company_id: companyId },
    });
    if (!enquiry) throw new NotFoundException('Enquiry not found');
    return enquiry;
  }
}
