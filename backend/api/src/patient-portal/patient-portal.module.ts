import { Module } from '@nestjs/common';
import { PatientPortalController } from './patient-portal.controller';
import { PatientPortalService } from './patient-portal.service';
import { PatientSelfController } from './patient-self.controller';

@Module({
  controllers: [PatientPortalController, PatientSelfController],
  providers: [PatientPortalService],
})
export class PatientPortalModule {}