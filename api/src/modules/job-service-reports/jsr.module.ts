import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { JsrService }    from './jsr.service';
import { JsrController } from './jsr.controller';

@Module({
  imports:     [PrismaModule],
  controllers: [JsrController],
  providers:   [JsrService],
  exports:     [JsrService],
})
export class JsrModule {}
