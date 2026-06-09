import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateTodoDto } from './create-todo.dto';
import { UpdateTodoDto } from './update-todo.dto';
import { TodoStatus } from '@prisma/client';

const TODO_INCLUDE = {
  created_by: { select: { id: true, name: true } },
  assigned_to: { select: { id: true, name: true } },
  done_by: { select: { id: true, name: true } },
  job: { select: { id: true, title: true } },
} as const;

@Injectable()
export class TodosService {
  constructor(private readonly prisma: PrismaService) {}

  async create(companyId: string, createdById: string, dto: CreateTodoDto) {
    return this.prisma.client.todo.create({
      data: {
        company_id: companyId,
        created_by_id: createdById,
        title: dto.title,
        description: dto.description,
        priority: dto.priority ?? 'MEDIUM',
        assigned_to_id: dto.assigned_to_id ?? null,
        job_id: dto.job_id ?? null,
        due_date: dto.due_date ? new Date(dto.due_date) : null,
      },
      include: TODO_INCLUDE,
    });
  }

  async findAll(
    companyId: string,
    userId: string,
    role: string,
    status?: TodoStatus,
  ) {
    const where =
      role === 'OWNER'
        ? { company_id: companyId, status: status ?? undefined }
        : {
            company_id: companyId,
            status: status ?? undefined,
            OR: [{ assigned_to_id: userId }, { created_by_id: userId }],
          };

    const orderBy =
      status === 'DONE'
        ? [{ done_at: 'desc' as const }]
        : [
            { due_date: { sort: 'asc' as const, nulls: 'last' as const } },
            { priority: 'desc' as const },
            { created_at: 'desc' as const },
          ];

    return this.prisma.client.todo.findMany({ where, orderBy, include: TODO_INCLUDE });
  }

  async findOne(companyId: string, userId: string, role: string, id: string) {
    const todo = await this.prisma.client.todo.findFirst({
      where: { id, company_id: companyId },
      include: TODO_INCLUDE,
    });
    if (!todo) throw new NotFoundException('Todo not found');
    this.assertCanSee(todo, userId, role);
    return todo;
  }

  async update(
    companyId: string,
    userId: string,
    role: string,
    id: string,
    dto: UpdateTodoDto,
  ) {
    const todo = await this.findOne(companyId, userId, role, id);
    if (role === 'ENGINEER') {
      if (todo.assigned_to_id !== userId && todo.created_by_id !== userId) {
        throw new ForbiddenException('Cannot update this todo');
      }
    }
    return this.prisma.client.todo.update({
      where: { id },
      data: {
        title: dto.title,
        description: dto.description,
        priority: dto.priority,
        assigned_to_id: dto.assigned_to_id,
        job_id: dto.job_id,
        due_date: dto.due_date !== undefined ? (dto.due_date ? new Date(dto.due_date) : null) : undefined,
      },
      include: TODO_INCLUDE,
    });
  }

  async markDone(companyId: string, userId: string, role: string, id: string) {
    const todo = await this.findOne(companyId, userId, role, id);
    this.assertCanSee(todo, userId, role);
    return this.prisma.client.todo.update({
      where: { id },
      data: { status: 'DONE', done_at: new Date(), done_by_id: userId },
      include: TODO_INCLUDE,
    });
  }

  async reopen(companyId: string, id: string) {
    const todo = await this.prisma.client.todo.findFirst({ where: { id, company_id: companyId } });
    if (!todo) throw new NotFoundException('Todo not found');
    return this.prisma.client.todo.update({
      where: { id },
      data: { status: 'OPEN', done_at: null, done_by_id: null },
      include: TODO_INCLUDE,
    });
  }

  async remove(
    companyId: string,
    userId: string,
    role: string,
    id: string,
  ) {
    const todo = await this.findOne(companyId, userId, role, id);
    if (role === 'ENGINEER' && todo.created_by_id !== userId) {
      throw new ForbiddenException('Cannot delete this todo');
    }
    await this.prisma.client.todo.delete({ where: { id } });
  }

  /** Returns overdue + due-today count for the badge. */
  async getBadgeCount(companyId: string, userId: string, role: string) {
    const now = new Date();
    const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

    const where =
      role === 'OWNER'
        ? {
            company_id: companyId,
            status: 'OPEN' as TodoStatus,
            due_date: { lte: todayEnd },
          }
        : {
            company_id: companyId,
            status: 'OPEN' as TodoStatus,
            due_date: { lte: todayEnd },
            OR: [{ assigned_to_id: userId }, { created_by_id: userId }],
          };

    return this.prisma.client.todo.count({ where });
  }

  private assertCanSee(
    todo: { assigned_to_id: string | null; created_by_id: string },
    userId: string,
    role: string,
  ) {
    if (role === 'OWNER') return;
    if (todo.assigned_to_id === userId || todo.created_by_id === userId) return;
    throw new ForbiddenException('Cannot access this todo');
  }
}
