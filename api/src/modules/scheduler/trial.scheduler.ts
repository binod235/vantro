import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { TrialService } from './trial.service';
import { TrialReminderService } from './trial-reminder.service';

@Injectable()
export class TrialScheduler {
  constructor(
    private readonly trialService: TrialService,
    private readonly trialReminderService: TrialReminderService,
  ) {}

  @Cron('5 0 * * *')
  async lockExpiredTrials() {
    await this.trialService.lockExpiredTrials();
  }

  @Cron('15 0 * * *')
  async sendTrialReminders() {
    await this.trialReminderService.sendReminders();
  }
}
