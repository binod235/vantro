import { Module } from '@nestjs/common';
import { GasCertificatesController } from './gas-certificates.controller';
import { GasCertificatesService } from './gas-certificates.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { CommsModule }  from '../comms/comms.module';

@Module({
  imports: [PrismaModule, CommsModule],
  controllers: [GasCertificatesController],
  providers: [GasCertificatesService],
  exports: [GasCertificatesService],
})
export class GasCertificatesModule {}
