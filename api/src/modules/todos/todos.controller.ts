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
  Query,
} from '@nestjs/common';
import { TodosService } from './todos.service';
import { CreateTodoDto } from './create-todo.dto';
import { UpdateTodoDto } from './update-todo.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { CurrentUserType } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { TodoStatus } from '@prisma/client';

@Controller('todos')
export class TodosController {
  constructor(private readonly todosService: TodosService) {}

  @Get('badge')
  getBadge(@CurrentUser() user: CurrentUserType) {
    if (!user.companyId) return { count: 0 };
    return this.todosService.getBadgeCount(user.companyId, user.id, user.role).then(count => ({ count }));
  }

  @Get()
  findAll(
    @CurrentUser() user: CurrentUserType,
    @Query('status') status?: string,
  ) {
    if (!user.companyId) return [];
    const s = status === 'DONE' ? TodoStatus.DONE : status === 'OPEN' ? TodoStatus.OPEN : undefined;
    return this.todosService.findAll(user.companyId, user.id, user.role, s);
  }

  @Post()
  create(@Body() dto: CreateTodoDto, @CurrentUser() user: CurrentUserType) {
    return this.todosService.create(user.companyId!, user.id, dto);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: CurrentUserType) {
    return this.todosService.findOne(user.companyId!, user.id, user.role, id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateTodoDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.todosService.update(user.companyId!, user.id, user.role, id, dto);
  }

  @Patch(':id/done')
  markDone(@Param('id') id: string, @CurrentUser() user: CurrentUserType) {
    return this.todosService.markDone(user.companyId!, user.id, user.role, id);
  }

  @Patch(':id/reopen')
  @Roles('OWNER')
  reopen(@Param('id') id: string, @CurrentUser() user: CurrentUserType) {
    return this.todosService.reopen(user.companyId!, id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string, @CurrentUser() user: CurrentUserType) {
    return this.todosService.remove(user.companyId!, user.id, user.role, id);
  }
}
