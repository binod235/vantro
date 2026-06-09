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
  ],
})
export class AppModule {}
