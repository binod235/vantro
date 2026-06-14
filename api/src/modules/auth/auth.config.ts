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

  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false,

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
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
  },

  trustedOrigins: [
    process.env.BETTER_AUTH_URL  ?? 'http://localhost:3000',
    process.env.FRONTEND_URL     ?? 'http://localhost:3001',
    process.env.FRONTEND_URL_WWW ?? 'http://localhost:3001',
    'http://localhost:3001',
  ],
});

export type Auth = typeof auth;
export type Session = typeof auth.$Infer.Session;
