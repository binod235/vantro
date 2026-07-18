import { Module } from '@nestjs/common';
import { EnquiriesController } from './enquiries.controller';
import { EnquiriesService } from './enquiries.service';
import { ConciergeService } from './concierge.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { CommsModule } from '../comms/comms.module';

@Module({
  imports: [PrismaModule, CommsModule],
  controllers: [EnquiriesController],
  providers: [EnquiriesService, ConciergeService],
})
export class EnquiriesModule {}
