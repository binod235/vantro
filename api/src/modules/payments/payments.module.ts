import { Module } from '@nestjs/common';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { CommsModule }  from '../comms/comms.module';

@Module({
  imports:     [PrismaModule, CommsModule],
  controllers: [PaymentsController],
  providers:   [PaymentsService],
})
export class PaymentsModule {}
