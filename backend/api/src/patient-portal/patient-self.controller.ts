import { Controller, Get } from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { PatientPortalService } from './patient-portal.service';

@Roles('PATIENT')
@Controller('me')
export class PatientSelfController {
  constructor(private readonly portal: PatientPortalService) {}

  @Get('appointments')
  appointments(@CurrentUser() user: AuthUser) {
    return this.portal.myAppointments(user.hospitalId, user.userId);
  }

  @Get('prescriptions')
  prescriptions(@CurrentUser() user: AuthUser) {
    return this.portal.myPrescriptions(user.hospitalId, user.userId);
  }
}