import { Module } from '@nestjs/common';
import { RemindersService }    from './reminders.service';
import { RemindersController } from './reminders.controller';
import { PrismaModule }        from '../../prisma/prisma.module';
import { CommsModule }         from '../comms/comms.module';

@Module({
  imports:     [PrismaModule, CommsModule],
  providers:   [RemindersService],
  controllers: [RemindersController],
  exports:     [RemindersService],
})
export class RemindersModule {}
