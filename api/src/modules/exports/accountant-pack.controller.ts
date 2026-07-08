import { BadRequestException, Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { IsString, Matches } from 'class-validator';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser, type CurrentUserType } from '../auth/decorators/current-user.decorator';
import { AccountantPackService } from './accountant-pack.service';

class GeneratePackDto {
  @IsString()
  @Matches(/^\d{4}-\d{2}$/, { message: 'month must be YYYY-MM' })
  month!: string;
}

@Controller('api/exports')
@Roles('OWNER')
export class AccountantPackController {
  constructor(private readonly service: AccountantPackService) {}

  // POST /api/exports/accountant-pack { month } → { url }
  @Post('accountant-pack')
  @HttpCode(HttpStatus.OK)
  generate(
    @CurrentUser() user: CurrentUserType,
    @Body() dto: GeneratePackDto,
  ) {
    return this.service.generate(user.companyId!, dto.month);
  }

  // POST /api/exports/accountant-pack/email { month } → { success, recipient }
  @Post('accountant-pack/email')
  @HttpCode(HttpStatus.OK)
  async email(
    @CurrentUser() user: CurrentUserType,
    @Body() dto: GeneratePackDto,
  ) {
    try {
      return await this.service.emailToAccountant(user.companyId!, dto.month);
    } catch (err) {
      throw new BadRequestException(err instanceof Error ? err.message : 'Failed to send pack');
    }
  }
}
