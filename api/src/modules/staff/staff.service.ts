import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Resend } from 'resend';
import { randomBytes } from 'crypto';
import { hashPassword } from 'better-auth/crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { auth } from '../auth/auth.config';
import { inviteEmailHtml } from '../auth/templates/invite.email';
import type { CurrentUserType } from '../auth/decorators/current-user.decorator';
import type { InviteStaffDto } from './dto/invite-staff.dto';
import type { AcceptInviteDto } from './dto/accept-invite.dto';
import type { UpdateStaffDto } from './dto/update-staff.dto';

const STAFF_SELECT = {
  id: true,
  name: true,
  email: true,
  role: true,
  companyId: true,
  emailVerified: true,
  invite_token: false,
  invite_expires_at: true,
  createdAt: true,
} as const;

@Injectable()
export class StaffService {
  constructor(private readonly prisma: PrismaService) {}

  // ── Private helpers ───────────────────────────────────────────────────────

  private async sendInviteEmail(
    toEmail: string,
    toName: string,
    token: string,
    companyName: string,
  ) {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const inviteUrl = `${process.env.FRONTEND_URL ?? 'http://localhost:3001'}/accept-invite?token=${token}`;
    const { error } = await resend.emails.send({
      from: process.env.FROM_EMAIL ?? 'noreply@vantro.co.uk',
      to: toEmail,
      subject: `You've been invited to join ${companyName} on Vantro`,
      html: inviteEmailHtml(inviteUrl, companyName),
    });
    if (error) throw new Error(`Failed to send invite email: ${error.message}`);
  }

  private async deletePendingUser(userId: string) {
    await this.prisma.client.$transaction(async (tx) => {
      await tx.account.deleteMany({ where: { userId } });
      await tx.user.delete({ where: { id: userId } });
    });
  }

  // ── Invite ────────────────────────────────────────────────────────────────

  async invite(dto: InviteStaffDto, caller: CurrentUserType) {
    if (!caller.companyId) {
      throw new BadRequestException('No company associated with your account');
    }

    const existing = await this.prisma.client.user.findUnique({
      where: { email: dto.email },
      select: { id: true, companyId: true, emailVerified: true },
    });

    if (existing) {
      // Stale pending invite for this company, or a removed pending user with
      // companyId null — clean up and allow re-invite
      const isStale =
        !existing.emailVerified &&
        (existing.companyId === caller.companyId || existing.companyId === null);

      if (isStale) {
        await this.deletePendingUser(existing.id);
        // fall through to create a fresh invite
      } else if (existing.companyId === caller.companyId) {
        throw new ConflictException('A staff member with that email already exists');
      } else {
        throw new ConflictException('That email is already registered with another company');
      }
    }

    const company = await this.prisma.client.company.findUnique({
      where: { id: caller.companyId },
      select: { name: true },
    });

    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000); // 48 hours

    // Create a pending user account — temporary password overwritten on accept
    const result = await auth.api.signUpEmail({
      body: {
        email: dto.email,
        name: dto.name,
        password: token,
        role: 'ENGINEER',
      },
    });

    await this.prisma.client.user.update({
      where: { id: result.user.id },
      data: {
        companyId: caller.companyId,
        invite_token: token,
        invite_expires_at: expiresAt,
      },
    });

    await this.sendInviteEmail(
      dto.email,
      dto.name,
      token,
      company?.name ?? 'your company',
    );

    return { message: 'Invitation sent' };
  }

  // ── Accept invite ─────────────────────────────────────────────────────────

  async acceptInvite(dto: AcceptInviteDto) {
    const user = await this.prisma.client.user.findUnique({
      where: { invite_token: dto.token },
      select: {
        id: true,
        email: true,
        invite_expires_at: true,
        companyId: true,
      },
    });

    if (!user) throw new NotFoundException('Invalid or expired invitation');
    if (!user.invite_expires_at || user.invite_expires_at < new Date()) {
      throw new BadRequestException('This invitation has expired');
    }

    // Use Better Auth's own hashPassword (scrypt) — bcryptjs produces an
    // incompatible hash format that Better Auth's verifyPassword cannot verify.
    const passwordHash = await hashPassword(dto.password);
    await this.prisma.client.$transaction(async (tx) => {
      await tx.account.updateMany({
        where: { userId: user.id, providerId: 'credential' },
        data: { password: passwordHash },
      });
      await tx.user.update({
        where: { id: user.id },
        data: { invite_token: null, invite_expires_at: null, emailVerified: true },
      });
    });

    return { message: 'Account activated' };
  }

  // ── Resend invite ─────────────────────────────────────────────────────────

  async resendInvite(companyId: string, userId: string) {
    const user = await this.prisma.client.user.findFirst({
      where: { id: userId, companyId },
      select: {
        id: true,
        email: true,
        name: true,
        emailVerified: true,
      },
    });

    if (!user) throw new NotFoundException('Staff member not found');

    if (user.emailVerified) {
      throw new BadRequestException('This user has already accepted their invite');
    }

    const newToken = randomBytes(32).toString('hex');
    const newExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    // Update the credential account's temporary password to match the new token,
    // so the old token can't be used to log in as a placeholder account
    const newPasswordHash = await hashPassword(newToken);
    await this.prisma.client.$transaction(async (tx) => {
      await tx.account.updateMany({
        where: { userId: user.id, providerId: 'credential' },
        data: { password: newPasswordHash },
      });
      await tx.user.update({
        where: { id: user.id },
        data: { invite_token: newToken, invite_expires_at: newExpiry },
      });
    });

    const company = await this.prisma.client.company.findFirst({
      where: { id: companyId },
      select: { name: true },
    });

    await this.sendInviteEmail(
      user.email,
      user.name,
      newToken,
      company?.name ?? 'your company',
    );

    return { message: 'Invite resent successfully' };
  }

  // ── List ──────────────────────────────────────────────────────────────────

  async findAll(companyId: string) {
    return this.prisma.client.user.findMany({
      where: { companyId },
      select: STAFF_SELECT,
      orderBy: { createdAt: 'asc' },
    });
  }

  // ── Update ────────────────────────────────────────────────────────────────

  async update(id: string, dto: UpdateStaffDto, caller: CurrentUserType) {
    const companyId = caller.companyId;
    if (!companyId) throw new BadRequestException('No company associated with your account');

    const member = await this.prisma.client.user.findFirst({
      where: { id, companyId },
      select: { id: true, role: true },
    });
    if (!member) throw new NotFoundException('Staff member not found');

    if (dto.role === 'ENGINEER' && member.role === 'OWNER') {
      const ownerCount = await this.prisma.client.user.count({
        where: { companyId, role: 'OWNER' },
      });
      if (ownerCount <= 1) {
        throw new BadRequestException('Cannot demote the last owner');
      }
    }

    return this.prisma.client.user.update({
      where: { id },
      data: { name: dto.name, role: dto.role },
      select: STAFF_SELECT,
    });
  }

  // ── Remove ────────────────────────────────────────────────────────────────

  async remove(id: string, caller: CurrentUserType) {
    if (caller.id === id) {
      throw new BadRequestException('You cannot remove yourself');
    }
    const companyId = caller.companyId;
    if (!companyId) throw new BadRequestException('No company associated with your account');

    const member = await this.prisma.client.user.findFirst({
      where: { id, companyId },
      select: { id: true, emailVerified: true, invite_expires_at: true },
    });
    if (!member) throw new NotFoundException('Staff member not found');

    // Pending invite = never logged in, token still exists. Delete entirely so
    // the email address can be re-invited without hitting a duplicate conflict.
    const isPendingInvite = !member.emailVerified && member.invite_expires_at !== null;

    if (isPendingInvite) {
      await this.deletePendingUser(member.id);
    } else {
      // Active engineer — unlink from company but preserve their account
      await this.prisma.client.user.update({
        where: { id },
        data: { companyId: null },
      });
    }
  }
}
