import { Body, Controller, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { CreatePatientLoginDto } from './dto/create-patient-login.dto';
import { PatientPortalService } from './patient-portal.service';

@Controller('patients')
export class PatientPortalController {
  constructor(private readonly portal: PatientPortalService) {}

  @Roles('HOSPITAL_ADMIN', 'RECEPTIONIST')
  @Post(':id/login')
  createLogin(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreatePatientLoginDto,
  ) {
    return this.portal.createLogin(user.hospitalId, user.userId, id, dto);
  }
}