import { Controller, Post } from '@nestjs/common';
import { RemindersService } from './reminders.service';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller('reminders')
@Roles('OWNER')
export class RemindersController {
  constructor(private readonly remindersService: RemindersService) {}

  @Post('trigger/payments')
  triggerPayments() {
    return this.remindersService.triggerPaymentReminders();
  }

  @Post('trigger/cp12')
  triggerCp12() {
    return this.remindersService.triggerCp12Reminders();
  }

  @Post('trigger/quote-reminders')
  triggerQuoteReminders() {
    return this.remindersService.triggerQuoteReminders();
  }

  @Post('trigger/appointments')
  triggerAppointments() {
    return this.remindersService.triggerAppointmentReminders();
  }
}
