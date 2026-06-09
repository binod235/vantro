import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';

@Injectable()
export class CustomersService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: CreateCustomerDto, companyId: string) {
    return this.prisma.client.customer.create({
      data: { ...dto, company_id: companyId },
    });
  }

  findAll(companyId: string) {
    return this.prisma.client.customer.findMany({
      where: { company_id: companyId },
      orderBy: { name: 'asc' },
    });
  }

  async findOne(id: string, companyId: string) {
    const customer = await this.prisma.client.customer.findFirst({
      where: { id, company_id: companyId },
    });
    if (!customer) throw new NotFoundException('Customer not found');
    return customer;
  }

  async update(id: string, dto: UpdateCustomerDto, companyId: string) {
    await this.findOne(id, companyId);
    return this.prisma.client.customer.update({
      where: { id },
      data: dto,
    });
  }

  async remove(id: string, companyId: string) {
    await this.findOne(id, companyId);

    const jobCount = await this.prisma.client.job.count({
      where: { customer_id: id },
    });
    if (jobCount > 0) {
      throw new ConflictException(
        'Cannot delete a customer with existing jobs',
      );
    }

    await this.prisma.client.customer.delete({ where: { id } });
  }
}
