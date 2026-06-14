import { Module }               from '@nestjs/common';
import { PriceListsController } from './price-lists.controller';
import { PriceListsService }    from './price-lists.service';
import { PrismaModule }         from '../../prisma/prisma.module';

@Module({
  imports:     [PrismaModule],
  controllers: [PriceListsController],
  providers:   [PriceListsService],
  exports:     [PriceListsService],
})
export class PriceListsModule {}
