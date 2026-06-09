import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { StaffService } from './staff.service';
import { InviteStaffDto } from './dto/invite-staff.dto';
import { AcceptInviteDto } from './dto/accept-invite.dto';
import { UpdateStaffDto } from './dto/update-staff.dto';
import { CurrentUser, type CurrentUserType } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller('staff')
export class StaffController {
  constructor(private readonly staffService: StaffService) {}

  @Post('invite')
  @Roles('OWNER')
  invite(@Body() dto: InviteStaffDto, @CurrentUser() user: CurrentUserType) {
    return this.staffService.invite(dto, user);
  }

  @Post('accept-invite')
  @Public()
  acceptInvite(@Body() dto: AcceptInviteDto) {
    return this.staffService.acceptInvite(dto);
  }

  @Get()
  @Roles('OWNER')
  findAll(@CurrentUser() user: CurrentUserType) {
    return this.staffService.findAll(user.companyId!);
  }

  @Patch(':id')
  @Roles('OWNER')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateStaffDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.staffService.update(id, dto, user);
  }

  @Post(':id/resend-invite')
  @Roles('OWNER')
  resendInvite(@Param('id') id: string, @CurrentUser() user: CurrentUserType) {
    return this.staffService.resendInvite(user.companyId!, id);
  }

  @Delete(':id')
  @Roles('OWNER')
  @HttpCode(204)
  remove(@Param('id') id: string, @CurrentUser() user: CurrentUserType) {
    return this.staffService.remove(id, user);
  }
}
