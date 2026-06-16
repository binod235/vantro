import { Module }         from '@nestjs/common';
import { HmrcController } from './hmrc.controller';
import { HmrcService }    from './hmrc.service';
import { PrismaModule }   from '../../prisma/prisma.module';

@Module({
  imports:     [PrismaModule],
  controllers: [HmrcController],
  providers:   [HmrcService],
  exports:     [HmrcService],
})
export class HmrcModule {}
