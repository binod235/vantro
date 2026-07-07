import { Module } from '@nestjs/common';
import { RemindersService }       from './reminders.service';
import { RemindersController }    from './reminders.controller';
import { AutoChaseService }       from './auto-chase.service';
import { ChasePolicyController }  from './chase-policy.controller';
import { PrismaModule }           from '../../prisma/prisma.module';
import { CommsModule }            from '../comms/comms.module';

@Module({
  imports:     [PrismaModule, CommsModule],
  providers:   [RemindersService, AutoChaseService],
  controllers: [RemindersController, ChasePolicyController],
  exports:     [RemindersService, AutoChaseService],
})
export class RemindersModule {}
