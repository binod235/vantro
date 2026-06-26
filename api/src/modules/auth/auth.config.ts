import 'dotenv/config';
import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { Resend } from 'resend';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { resetPasswordEmailHtml } from './templates/reset-password.email';

// Standalone Prisma instance for Better Auth — created once at module load
// before NestJS DI is available.
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL ?? 'http://localhost:3000',
  basePath: '/api/auth',

  database: prismaAdapter(prisma, { provider: 'postgresql' }),

  emailVerification: {
    sendOnSignUp: true,
    sendVerificationEmail: async ({ user, token }) => {
      const verificationUrl =
        `${process.env.BETTER_AUTH_URL ?? 'http://localhost:3000'}/api/auth/verify-email?token=${token}` +
        `&callbackURL=${encodeURIComponent((process.env.FRONTEND_URL ?? 'http://localhost:3001') + '/dashboard/jobs')}`;

      const resend = new Resend(process.env.RESEND_API_KEY);
      const { error } = await resend.emails.send({
        from:    process.env.FROM_EMAIL ?? 'noreply@vantro.co.uk',
        to:      user.email,
        subject: 'Verify your Vantro account',
        html: `
          <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
            <h1 style="color:#2563eb;font-size:28px;margin-bottom:8px;">Welcome to Vantro</h1>
            <p style="color:#475569;font-size:16px;margin-bottom:24px;">
              Thanks for signing up! Please verify your email address to activate your account.
            </p>
            <a href="${verificationUrl}"
              style="display:inline-block;background:#2563eb;color:white;
                padding:14px 32px;border-radius:8px;text-decoration:none;
                font-weight:600;font-size:16px;margin-bottom:24px;">
              Verify Email Address →
            </a>
            <p style="color:#94a3b8;font-size:13px;">
              This link expires in 24 hours. If you didn't create a Vantro account, ignore this email.
            </p>
          </div>
        `,
      });
      if (error) {
        console.error('Verification email failed', error);
        throw new Error(`Verification email failed: ${error.message}`);
      }
    },
  },

  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,

    // Reset token expires in 1 hour. Better Auth deletes it from the
    // verification table on use so the same token cannot be used twice.
    resetPasswordTokenExpiresIn: 3600,

    sendResetPassword: async ({ user, token }) => {
      const resetUrl = `${process.env.FRONTEND_URL ?? 'http://localhost:3001'}/reset-password?token=${token}`;

      // Initialised here so a missing key only fails when an email is actually
      // sent, not at server startup (key is not required in local development).
      const resend = new Resend(process.env.RESEND_API_KEY);
      const { error } = await resend.emails.send({
        from: process.env.FROM_EMAIL ?? 'noreply@vantro.co.uk',
        to: user.email,
        subject: 'Reset your Vantro password',
        html: resetPasswordEmailHtml(resetUrl),
      });
      if (error) throw new Error(`Failed to send password reset email: ${error.message}`);
    },

    // Successfully resetting a password via an emailed token is itself proof
    // of email ownership — mirror the same logic already used for engineer
    // invite-accept (staff.service.ts) so a previously-unverified owner isn't
    // left permanently unable to sign in (requireEmailVerification blocks
    // sign-in regardless of how correct the new password is). Called by
    // Better Auth only after it has already updated the password.
    onPasswordReset: async ({ user }) => {
      await prisma.user.update({
        where: { id: user.id },
        data: { emailVerified: true },
      });
    },
  },

  user: {
    additionalFields: {
      role: {
        type: 'string',
        defaultValue: 'ENGINEER',
        input: true,
      },
      companyId: {
        type: 'string',
        required: false,
        input: false,
      },
    },
  },

  session: {
    expiresIn: 60 * 60 * 24 * 30, // 30 days max
    updateAge: 60 * 60 * 24,       // refresh daily
    cookieCache: {
      enabled: true,
      maxAge:  60 * 5, // 5 min cache
    },
  },

  trustedOrigins: [
    'https://vantro.co.uk',
    'https://www.vantro.co.uk',
    'http://localhost:3001',
  ],

  advanced: {
    crossSubdomainCookies: {
      enabled: false,
    },
    defaultCookieAttributes: {
      secure: true,
      httpOnly: true,
      sameSite: 'none',
      partitioned: true,
    },
  },
});

export type Auth = typeof auth;
export type Session = typeof auth.$Infer.Session;
