import { Module }                      from '@nestjs/common';
import { RecurringJobsController }     from './recurring-jobs.controller';
import { RecurringJobsService }        from './recurring-jobs.service';
import { PrismaModule }                from '../../prisma/prisma.module';
import { JobNotificationsService }     from '../jobs/job-notifications.service';

@Module({
  imports:     [PrismaModule],
  controllers: [RecurringJobsController],
  providers:   [RecurringJobsService, JobNotificationsService],
  exports:     [RecurringJobsService],
})
export class RecurringJobsModule {}
