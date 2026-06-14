import { Module }          from '@nestjs/common';
import { CommsService }    from './comms.service';
import { CommsController } from './comms.controller';
import { PrismaModule }    from '../../prisma/prisma.module';

@Module({
  imports:     [PrismaModule],
  controllers: [CommsController],
  providers:   [CommsService],
  exports:     [CommsService],
})
export class CommsModule {}
