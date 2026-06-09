import { Module } from '@nestjs/common';
import { InvoicesController } from './invoices.controller';
import { InvoicesService } from './invoices.service';
import { PrismaModule } from '../../prisma/prisma.module'; // ⚠️ adapt path if yours differs
 
@Module({
  imports: [PrismaModule],
  controllers: [InvoicesController],
  providers: [InvoicesService],
  exports: [InvoicesService], // export if other modules (e.g. CIS) need it later
})
export class InvoicesModule {}
 