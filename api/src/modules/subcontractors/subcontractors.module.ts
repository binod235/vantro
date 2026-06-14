import { Module } from '@nestjs/common';
import { SubcontractorsController } from './subcontractors.controller';
import { SubcontractorsService } from './subcontractors.service';
import { SubcontractorPaymentsService } from './subcontractor-payments.service';
import { CisEngineService } from './cis-engine.service';
import { CisSufferedService } from './cis-suffered.service';

@Module({
  controllers: [SubcontractorsController],
  providers: [SubcontractorsService, SubcontractorPaymentsService, CisEngineService, CisSufferedService],
})
export class SubcontractorsModule {}
