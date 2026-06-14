import {
  Body, Controller, Delete, Get, HttpCode, HttpStatus,
  Param, Patch, Post,
} from '@nestjs/common';
import { RecurringJobsService }  from './recurring-jobs.service';
import { CreateRecurringJobDto } from './dto/create-recurring-job.dto';
import { UpdateRecurringJobDto } from './dto/update-recurring-job.dto';
import { CurrentUser }           from '../auth/decorators/current-user.decorator';
import type { CurrentUserType }  from '../auth/decorators/current-user.decorator';
import { Roles }                 from '../auth/decorators/roles.decorator';

@Controller('recurring-jobs')
@Roles('OWNER')
export class RecurringJobsController {
  constructor(private readonly svc: RecurringJobsService) {}

  @Get()
  list(@CurrentUser() user: CurrentUserType) {
    return this.svc.list(user.companyId!);
  }

  @Post()
  create(
    @CurrentUser() user: CurrentUserType,
    @Body() dto: CreateRecurringJobDto,
  ) {
    return this.svc.create(user.companyId!, dto);
  }

  @Get(':id')
  getOne(@CurrentUser() user: CurrentUserType, @Param('id') id: string) {
    return this.svc.getOne(user.companyId!, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: CurrentUserType,
    @Param('id') id: string,
    @Body() dto: UpdateRecurringJobDto,
  ) {
    return this.svc.update(user.companyId!, id, dto);
  }

  @Patch(':id/toggle')
  @HttpCode(HttpStatus.OK)
  toggle(@CurrentUser() user: CurrentUserType, @Param('id') id: string) {
    return this.svc.toggleActive(user.companyId!, id);
  }

  @Post(':id/trigger')
  @HttpCode(HttpStatus.OK)
  triggerNow(@CurrentUser() user: CurrentUserType, @Param('id') id: string) {
    return this.svc.triggerNow(user.companyId!, id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentUser() user: CurrentUserType,
    @Param('id') id: string,
  ): Promise<void> {
    await this.svc.remove(user.companyId!, id);
  }
}
