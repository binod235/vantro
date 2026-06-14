import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

const TEMPLATE_INCLUDE = {
  default_engineer: { select: { id: true, name: true } },
} as const;

@Injectable()
export class JobTemplatesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(companyId: string) {
    return this.prisma.client.jobTemplate.findMany({
      where:   { company_id: companyId, is_active: true },
      include: TEMPLATE_INCLUDE,
      orderBy: [{ use_count: 'desc' }, { name: 'asc' }],
    });
  }

  async create(companyId: string, dto: {
    name:                string;
    title:               string;
    description?:        string;
    schedule_note?:      string;
    duration_minutes?:   number;
    default_engineer_id?: string;
  }) {
    return this.prisma.client.jobTemplate.create({
      data: {
        company_id:          companyId,
        name:                dto.name,
        title:               dto.title,
        description:         dto.description         ?? null,
        schedule_note:       dto.schedule_note       ?? null,
        duration_minutes:    dto.duration_minutes    ?? null,
        default_engineer_id: dto.default_engineer_id ?? null,
      },
      include: TEMPLATE_INCLUDE,
    });
  }

  async update(companyId: string, templateId: string, dto: Partial<{
    name:                string;
    title:               string;
    description:         string | null;
    schedule_note:       string | null;
    duration_minutes:    number | null;
    default_engineer_id: string | null;
  }>) {
    const tpl = await this.prisma.client.jobTemplate.findFirst({
      where: { id: templateId, company_id: companyId },
    });
    if (!tpl) throw new NotFoundException('Template not found');
    return this.prisma.client.jobTemplate.update({
      where:   { id: templateId },
      data:    dto as never,
      include: TEMPLATE_INCLUDE,
    });
  }

  async remove(companyId: string, templateId: string): Promise<void> {
    const tpl = await this.prisma.client.jobTemplate.findFirst({
      where: { id: templateId, company_id: companyId },
    });
    if (!tpl) throw new NotFoundException('Template not found');
    await this.prisma.client.jobTemplate.update({
      where: { id: templateId },
      data:  { is_active: false },
    });
  }

  async incrementUseCount(companyId: string, templateId: string) {
    await this.prisma.client.jobTemplate.updateMany({
      where: { id: templateId, company_id: companyId },
      data:  { use_count: { increment: 1 } },
    });
  }
}
