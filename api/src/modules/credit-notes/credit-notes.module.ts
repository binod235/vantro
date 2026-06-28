import { Module } from '@nestjs/common';
import { CreditNotesController } from './credit-notes.controller';
import { CreditNotesService } from './credit-notes.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { CommsModule }   from '../comms/comms.module';

@Module({
  imports: [PrismaModule, CommsModule],
  controllers: [CreditNotesController],
  providers: [CreditNotesService],
  exports: [CreditNotesService],
})
export class CreditNotesModule {}
