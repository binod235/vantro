import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { IsString, Matches } from 'class-validator';

class UpdateColourDto {
  @IsString()
  @Matches(/^#[0-9A-Fa-f]{6}$/, { message: 'colour must be a valid 6-digit hex colour' })
  colour: string;
}
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { CurrentUserType } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  /** Owner creates a new user (engineer or second owner) inside the company. */
  @Post()
  @Roles('OWNER')
  create(@Body() dto: CreateUserDto, @CurrentUser() user: CurrentUserType) {
    return this.usersService.create(dto, user);
  }

  /** List all users in the company. Owner only. */
  @Get()
  @Roles('OWNER')
  findAll(@CurrentUser() user: CurrentUserType) {
    if (!user.companyId) return [];
    return this.usersService.findAll(user.companyId);
  }

  /**
   * Get the current user's own profile.
   * Defined before /:id so NestJS does not treat "me" as a param.
   */
  @Get('me')
  getMe(@CurrentUser() user: CurrentUserType) {
    return this.usersService.findMe(user.id);
  }

  /** Get any user in the company by ID. Owner only. */
  @Get(':id')
  @Roles('OWNER')
  findOne(@Param('id') id: string, @CurrentUser() user: CurrentUserType) {
    if (!user.companyId) return null;
    return this.usersService.findOne(id, user.companyId);
  }

  /** Update a user. Owners can update anyone; engineers can update themselves only. */
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.usersService.update(id, dto, user);
  }

  /** Set a user's calendar colour. Owner only. */
  @Patch(':id/colour')
  @Roles('OWNER')
  updateColour(
    @Param('id') id: string,
    @Body() dto: UpdateColourDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.usersService.updateCalendarColour(id, dto.colour, user.companyId!);
  }

  /**
   * Remove a user from the company (sets companyId to null).
   * Does not delete the user record — preserves audit trail. Owner only.
   */
  @Delete(':id')
  @Roles('OWNER')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string, @CurrentUser() user: CurrentUserType) {
    return this.usersService.remove(id, user);
  }
}
