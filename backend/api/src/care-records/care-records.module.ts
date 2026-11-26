import { Module } from '@nestjs/common';
import { CareRecordsController } from './care-records.controller';
import { CareRecordsService } from './care-records.service';

@Module({
  controllers: [CareRecordsController],
  providers: [CareRecordsService],
})
export class CareRecordsModule {}