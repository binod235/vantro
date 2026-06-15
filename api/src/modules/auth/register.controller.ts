import { BadRequestException, Body, ConflictException, Controller, Post } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { auth } from './auth.config';
import { Public } from './decorators/public.decorator';
import { RegisterDto } from './dto/register.dto';

function generateSlug(companyName: string): string {
  return companyName
    .replace(/\b(ltd|limited|co|company)\b/gi, '')
    .replace(/&/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

@Controller('register')
export class RegisterController {
  constructor(private readonly prisma: PrismaService) {}

  @Post()
  @Public()
  async register(@Body() dto: RegisterDto) {
    const existing = await this.prisma.client.user.findUnique({
      where: { email: dto.email },
      select: {
        id: true,
        accounts: { where: { providerId: 'credential' }, select: { id: true } },
      },
    });
    if (existing) {
      if (existing.accounts.length === 0) {
        // User was invited but hasn't set a password yet
        throw new BadRequestException(
          'You have a pending invitation. Please check your email for the invite link, or contact your company owner to resend it.',
        );
      }
      throw new ConflictException('An account with that email already exists');
    }

    // Better Auth creates the user and hashes the password
    const result = await auth.api.signUpEmail({
      body: {
        name: dto.name,
        email: dto.email,
        password: dto.password,
        role: 'OWNER',
      },
    });

    const trialEndsAt = new Date();
    trialEndsAt.setDate(trialEndsAt.getDate() + 14);

    await this.prisma.client.$transaction(async (tx) => {
      let slug = generateSlug(dto.company_name);
      if (!slug) slug = 'company';

      const existing = await tx.company.findUnique({ where: { slug }, select: { id: true } });
      if (existing) {
        const suffix = Math.floor(1000 + Math.random() * 9000);
        slug = `${slug}-${suffix}`;
      }

      const company = await tx.company.create({
        data: {
          name: dto.company_name,
          slug,
          trial_ends_at: trialEndsAt,
        },
      });
      await tx.user.update({
        where: { id: result.user.id },
        data: { companyId: company.id, role: 'OWNER' },
      });
    });

    // @vantro.dev emails bypass verification (internal test accounts)
    if (dto.email.endsWith('@vantro.dev')) {
      await this.prisma.client.user.update({
        where: { email: dto.email },
        data: { emailVerified: true },
      });
    }

    return { message: 'Account created' };
  }
}
