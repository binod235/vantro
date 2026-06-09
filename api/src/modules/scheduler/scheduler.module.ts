import { Module } from '@nestjs/common';
import { TrialScheduler } from './trial.scheduler';
import { TrialService } from './trial.service';
import { TrialReminderService } from './trial-reminder.service';
import { InternalController } from './internal.controller';

@Module({
  controllers: [InternalController],
  providers: [TrialService, TrialReminderService, TrialScheduler],
})
export class SchedulerModule {}
