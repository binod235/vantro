import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { CreateSupplierDto } from './dto/create-supplier.dto';
import type { UpdateSupplierDto } from './dto/update-supplier.dto';

@Injectable()
export class SuppliersService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: CreateSupplierDto, companyId: string) {
    return this.prisma.client.supplier.create({
      data: { ...dto, company_id: companyId },
    });
  }

  findAll(companyId: string, archived: boolean) {
    return this.prisma.client.supplier.findMany({
      where: { company_id: companyId, is_archived: archived },
      orderBy: { name: 'asc' },
    });
  }

  async findOne(id: string, companyId: string) {
    const supplier = await this.prisma.client.supplier.findFirst({
      where: { id, company_id: companyId },
    });
    if (!supplier) throw new NotFoundException('Supplier not found');
    return supplier;
  }

  async update(id: string, dto: UpdateSupplierDto, companyId: string) {
    await this.findOne(id, companyId);
    return this.prisma.client.supplier.update({ where: { id }, data: dto });
  }

  async archive(id: string, companyId: string) {
    await this.findOne(id, companyId);
    return this.prisma.client.supplier.update({
      where: { id },
      data: { is_archived: true },
    });
  }

  async unarchive(id: string, companyId: string) {
    await this.findOne(id, companyId);
    return this.prisma.client.supplier.update({
      where: { id },
      data: { is_archived: false },
    });
  }

  async remove(id: string, companyId: string) {
    await this.findOne(id, companyId);

    const [billCount, poCount] = await Promise.all([
      this.prisma.client.bill.count({ where: { supplier_id: id } }),
      this.prisma.client.purchaseOrder.count({ where: { supplier_id: id } }),
    ]);

    if (billCount > 0 || poCount > 0) {
      throw new ConflictException(
        'Cannot delete a supplier with existing bills or purchase orders',
      );
    }

    await this.prisma.client.supplier.delete({ where: { id } });
  }
}
