import { Module } from '@nestjs/common';
import { AppliancesController } from './appliances.controller';
import { AppliancesService } from './appliances.service';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [AppliancesController],
  providers: [AppliancesService],
  exports: [AppliancesService],
})
export class AppliancesModule {}
