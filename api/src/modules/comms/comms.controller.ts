import { Controller, Get, Param, Query } from '@nestjs/common';
import { CommsService }  from './comms.service';
import { CurrentUser }   from '../auth/decorators/current-user.decorator';
import type { CurrentUserType } from '../auth/decorators/current-user.decorator';
import { Roles }         from '../auth/decorators/roles.decorator';

@Controller('comms')
@Roles('OWNER')
export class CommsController {
  constructor(private readonly svc: CommsService) {}

  @Get('customer/:customerId')
  byCustomer(
    @CurrentUser() user: CurrentUserType,
    @Param('customerId') customerId: string,
  ) {
    return this.svc.listByCustomer(user.companyId!, customerId);
  }

  @Get('job/:jobId')
  byJob(
    @CurrentUser() user: CurrentUserType,
    @Param('jobId') jobId: string,
  ) {
    return this.svc.listByJob(user.companyId!, jobId);
  }

  @Get()
  all(
    @CurrentUser() user: CurrentUserType,
    @Query('customer_id') customer_id?: string,
    @Query('type') type?: string,
  ) {
    return this.svc.listByCompany(user.companyId!, { customer_id, type });
  }
}
