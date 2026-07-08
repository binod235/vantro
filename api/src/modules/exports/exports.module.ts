import { Module } from '@nestjs/common';
import { AccountantPackService } from './accountant-pack.service';
import { AccountantPackController } from './accountant-pack.controller';
import { SubcontractorsModule } from '../subcontractors/subcontractors.module';
import { StorageModule } from '../../storage/storage.module';

@Module({
  imports: [SubcontractorsModule, StorageModule],
  controllers: [AccountantPackController],
  providers: [AccountantPackService],
  exports: [AccountantPackService],
})
export class ExportsModule {}
