import { Module } from '@nestjs/common';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { AiToolsService } from './ai-tools.service';
import { PipInsightsService } from './pip-insights.service';
import { JobsModule } from '../jobs/jobs.module';
import { CustomersModule } from '../customers/customers.module';
import { QuotesModule } from '../quotes/quotes.module';
import { InvoicesModule } from '../invoices/invoices.module';
import { SubcontractorsModule } from '../subcontractors/subcontractors.module';
import { RemindersModule } from '../reminders/reminders.module';
import { StorageModule } from '../../storage/storage.module';

@Module({
  imports: [
    JobsModule,
    CustomersModule,
    QuotesModule,
    InvoicesModule,
    SubcontractorsModule,
    RemindersModule,
    StorageModule,
  ],
  controllers: [AiController],
  providers: [AiService, AiToolsService, PipInsightsService],
})
export class AiModule {}
