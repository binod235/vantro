import { Controller, Post } from '@nestjs/common';
import { RemindersService } from './reminders.service';
import { CurrentUser, type CurrentUserType } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller('reminders')
@Roles('OWNER')
export class RemindersController {
  constructor(private readonly remindersService: RemindersService) {}

  @Post('trigger/payments')
  triggerPayments(@CurrentUser() user: CurrentUserType) {
    return this.remindersService.triggerPaymentReminders(user.companyId!);
  }

  @Post('trigger/cp12')
  triggerCp12(@CurrentUser() user: CurrentUserType) {
    return this.remindersService.triggerCp12Reminders(user.companyId!);
  }

  @Post('trigger/quote-reminders')
  triggerQuoteReminders(@CurrentUser() user: CurrentUserType) {
    return this.remindersService.triggerQuoteReminders(user.companyId!);
  }

  @Post('trigger/appointments')
  triggerAppointments(@CurrentUser() user: CurrentUserType) {
    return this.remindersService.triggerAppointmentReminders(user.companyId!);
  }
}
