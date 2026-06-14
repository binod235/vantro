import { Module } from '@nestjs/common';
import { QuotesController } from './quotes.controller';
import { QuotesService } from './quotes.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { CommsModule }  from '../comms/comms.module';

@Module({
  imports: [PrismaModule, CommsModule],
  controllers: [QuotesController],
  providers: [QuotesService],
  exports: [QuotesService],
})
export class QuotesModule {}
