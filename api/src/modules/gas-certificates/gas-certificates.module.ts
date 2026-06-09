import { Module } from '@nestjs/common';
import { GasCertificatesController } from './gas-certificates.controller';
import { GasCertificatesService } from './gas-certificates.service';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [GasCertificatesController],
  providers: [GasCertificatesService],
  exports: [GasCertificatesService],
})
export class GasCertificatesModule {}
