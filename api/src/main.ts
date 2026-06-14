import 'dotenv/config'; // must be first — auth.config reads env at module load
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { toNodeHandler } from 'better-auth/node';
import cors from 'cors';
import type { IncomingMessage, ServerResponse } from 'http';
import type { Express } from 'express';
import { auth } from './modules/auth/auth.config';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });

  const expressApp = app.getHttpAdapter().getInstance() as Express;

  // Apply CORS at the Express level before Better Auth mounts, so that
  // /api/auth/* routes also get the correct Access-Control headers.
  expressApp.use(
    cors({
      origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
        const allowed = [
          process.env.FRONTEND_URL,
          process.env.FRONTEND_URL_WWW,
          'http://localhost:3001',
          'http://localhost:3000',
        ].filter(Boolean);

        // Allow requests with no origin (mobile apps, Postman, server-to-server)
        if (!origin) return callback(null, true);

        if (allowed.includes(origin)) {
          callback(null, true);
        } else {
          callback(new Error(`CORS: origin ${origin} not allowed`));
        }
      },
      credentials: true,
    }),
  );

  // Mount Better Auth before NestJS routing so /api/auth/* is handled by
  // Better Auth directly and never reaches NestJS controllers.
  const betterAuthHandler = toNodeHandler(auth);
  expressApp.use(
    (req: IncomingMessage, res: ServerResponse, next: () => void) => {
      if (req.url?.startsWith('/api/auth')) {
        return betterAuthHandler(req, res);
      }
      next();
    },
  );

  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  await app.listen(process.env.PORT ?? 3000);
  console.log(`API running on http://localhost:${process.env.PORT ?? 3000}`);
}

bootstrap();
