import { Module } from '@nestjs/common';
import { RemindersService }          from './reminders.service';
import { RemindersController }       from './reminders.controller';
import { AutoChaseService }          from './auto-chase.service';
import { ChasePolicyController }     from './chase-policy.controller';
import { QuoteChaseService }         from './quote-chase.service';
import { QuoteChasePolicyController } from './quote-chase-policy.controller';
import { RenewalAutopilotService }   from './renewal-autopilot.service';
import { RenewalPolicyController }   from './renewal-policy.controller';
import { ReviewRequestService }      from './review-request.service';
import { PrismaModule }              from '../../prisma/prisma.module';
import { CommsModule }               from '../comms/comms.module';

@Module({
  imports:     [PrismaModule, CommsModule],
  providers:   [RemindersService, AutoChaseService, QuoteChaseService, RenewalAutopilotService, ReviewRequestService],
  controllers: [RemindersController, ChasePolicyController, QuoteChasePolicyController, RenewalPolicyController],
  exports:     [RemindersService, AutoChaseService, QuoteChaseService, RenewalAutopilotService, ReviewRequestService],
})
export class RemindersModule {}
