import { join } from 'path';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ServeStaticModule } from '@nestjs/serve-static';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { CompaniesModule } from './modules/companies/companies.module';
import { UsersModule } from './modules/users/users.module';
import { CustomersModule } from './modules/customers/customers.module';
import { JobsModule } from './modules/jobs/jobs.module';
import { StaffModule } from './modules/staff/staff.module';
import { SuppliersModule } from './modules/suppliers/suppliers.module';
import { EnquiriesModule } from './modules/enquiries/enquiries.module';
import { SchedulerModule } from './modules/scheduler/scheduler.module';
import { TimesheetsModule } from './modules/timesheets/timesheets.module';
import { TodosModule } from './modules/todos/todos.module';
import { BillingModule } from './modules/billing/billing.module';
import { InvoicesModule } from './modules/invoices/invoices.module';
import { QuotesModule } from './modules/quotes/quotes.module';
import { GasCertificatesModule } from './modules/gas-certificates/gas-certificates.module';
import { RemindersModule }       from './modules/reminders/reminders.module';
import { RecurringJobsModule }   from './modules/recurring-jobs/recurring-jobs.module';
import { PriceListsModule }     from './modules/price-lists/price-lists.module';
import { PurchaseOrdersModule } from './modules/purchase-orders/purchase-orders.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { CommsModule }    from './modules/comms/comms.module';
import { JsrModule }     from './modules/job-service-reports/jsr.module';
import { SubcontractorsModule } from './modules/subcontractors/subcontractors.module';
import { HmrcModule }           from './modules/hmrc/hmrc.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    ServeStaticModule.forRoot({
      rootPath: join(process.cwd(), 'uploads'),
      serveRoot: '/uploads',
    }),
    PrismaModule,
    AuthModule,
    CompaniesModule,
    UsersModule,
    CustomersModule,
    JobsModule,
    StaffModule,
    SuppliersModule,
    EnquiriesModule,
    SchedulerModule,
    TimesheetsModule,
    TodosModule,
    BillingModule,
    InvoicesModule,
    QuotesModule,
    GasCertificatesModule,
    RemindersModule,
    RecurringJobsModule,
    PriceListsModule,
    PurchaseOrdersModule,
    PaymentsModule,
    CommsModule,
    JsrModule,
    SubcontractorsModule,
    HmrcModule,
  ],
})
export class AppModule {}
