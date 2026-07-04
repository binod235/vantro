import { Module } from '@nestjs/common';
import { JobsController } from './jobs.controller';
import { JobsService } from './jobs.service';
import { JobPhotosService } from './job-photos.service';
import { JobNotificationsService } from './job-notifications.service';
import { JobStagesService } from './job-stages.service';
import { JobTemplatesService } from './job-templates.service';
import { StorageModule } from '../../storage/storage.module';
import { RecurringJobsModule } from '../recurring-jobs/recurring-jobs.module';
import { InvoicesModule } from '../invoices/invoices.module';

@Module({
  imports:     [StorageModule, RecurringJobsModule, InvoicesModule],
  controllers: [JobsController],
  providers:   [JobsService, JobPhotosService, JobNotificationsService, JobStagesService, JobTemplatesService],
  exports:     [JobNotificationsService, JobsService],
})
export class JobsModule {}
