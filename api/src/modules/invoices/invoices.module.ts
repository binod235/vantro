import { Module } from '@nestjs/common';
import { InvoicesController } from './invoices.controller';
import { InvoicesService } from './invoices.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { CommsModule }   from '../comms/comms.module';
import { RemindersModule } from '../reminders/reminders.module';

@Module({
  imports: [PrismaModule, CommsModule, RemindersModule],
  controllers: [InvoicesController],
  providers: [InvoicesService],
  exports: [InvoicesService],
})
export class InvoicesModule {}
 