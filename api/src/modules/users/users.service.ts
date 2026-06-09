import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { auth } from '../auth/auth.config';
import type { CurrentUserType } from '../auth/decorators/current-user.decorator';
import type { CreateUserDto } from './dto/create-user.dto';
import type { UpdateUserDto } from './dto/update-user.dto';

/** Fields returned for every user — never expose password hashes or session data. */
const USER_SELECT = {
  id: true,
  name: true,
  email: true,
  role: true,
  companyId: true,
  emailVerified: true,
  calendar_colour: true,
  createdAt: true,
  updatedAt: true,
} as const;

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Owner creates a new user (typically an engineer) inside their company.
   * We delegate to Better Auth's own sign-up so the password is hashed
   * identically to a self-service sign-up.
   */
  async create(dto: CreateUserDto, caller: CurrentUserType) {
    if (!caller.companyId) {
      throw new BadRequestException('You must create a company before adding users');
    }

    // Check for duplicate email first so we can give a clear 409
    const duplicate = await this.prisma.client.user.findUnique({
      where: { email: dto.email },
      select: { id: true },
    });
    if (duplicate) throw new ConflictException('A user with that email already exists');

    // Use Better Auth's sign-up to create the account with correct password hashing
    const result = await auth.api.signUpEmail({
      body: {
        email: dto.email,
        password: dto.password,
        name: dto.name,
        role: dto.role ?? 'ENGINEER',
      },
    });

    // Link the new user to the caller's company
    return this.prisma.client.user.update({
      where: { id: result.user.id },
      data: { companyId: caller.companyId },
      select: USER_SELECT,
    });
  }

  /** List every user that belongs to the company. */
  async findAll(companyId: string) {
    return this.prisma.client.user.findMany({
      where: { companyId },
      select: USER_SELECT,
      orderBy: { createdAt: 'asc' },
    });
  }

  /** Get any user inside the company by ID. */
  async findOne(id: string, companyId: string) {
    const user = await this.prisma.client.user.findFirst({
      where: { id, companyId },
      select: USER_SELECT,
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  /** Get the currently authenticated user's own profile (fresh from DB). */
  async findMe(userId: string) {
    const user = await this.prisma.client.user.findUnique({
      where: { id: userId },
      select: USER_SELECT,
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  /** Owner updates any user in their company; a user may also update themselves. */
  async update(id: string, dto: UpdateUserDto, caller: CurrentUserType) {
    // Owner can update anyone in their company; non-owner can only update themselves
    if (caller.role !== 'OWNER' && caller.id !== id) {
      throw new ForbiddenException('You can only update your own profile');
    }

    const companyId = caller.companyId;
    if (!companyId) throw new BadRequestException('No company associated with this account');

    await this.findOne(id, companyId); // confirms the user exists in this company

    return this.prisma.client.user.update({
      where: { id },
      data: { name: dto.name, role: dto.role },
      select: USER_SELECT,
    });
  }

  async updateCalendarColour(id: string, colour: string, companyId: string) {
    if (!/^#[0-9A-Fa-f]{6}$/.test(colour)) {
      throw new BadRequestException('colour must be a valid 6-digit hex colour (e.g. #3B82F6)');
    }
    await this.findOne(id, companyId);
    return this.prisma.client.user.update({
      where: { id },
      data: { calendar_colour: colour },
      select: USER_SELECT,
    });
  }

  /**
   * Remove a user from the company by clearing their companyId.
   * This does not delete the user record — it preserves the audit trail
   * (gas certificates, timesheets, etc. keep their references intact).
   * Owners cannot remove themselves.
   */
  async remove(id: string, caller: CurrentUserType) {
    if (caller.id === id) {
      throw new BadRequestException('You cannot remove yourself from the company');
    }

    const companyId = caller.companyId;
    if (!companyId) throw new BadRequestException('No company associated with this account');

    await this.findOne(id, companyId); // confirms target exists in this company

    await this.prisma.client.user.update({
      where: { id },
      data: { companyId: null },
    });
  }
}
