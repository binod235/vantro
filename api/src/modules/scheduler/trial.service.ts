import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class TrialService {
  private readonly logger = new Logger(TrialService.name);

  constructor(private readonly prisma: PrismaService) {}

  async lockExpiredTrials(): Promise<number> {
    const now = new Date();
    try {
      const result = await this.prisma.client.company.updateMany({
        where: {
          subscription_status: 'TRIAL',
          trial_ends_at: { lt: now },
        },
        data: { subscription_status: 'LOCKED' },
      });

      if (result.count > 0) {
        this.logger.log(`Locked ${result.count} expired trial companies.`);
      } else {
        this.logger.log('No expired trial companies to lock.');
      }

      return result.count;
    } catch (err) {
      this.logger.error('Failed to lock expired trials', err);
      throw err;
    }
  }
}
