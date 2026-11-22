import { Body, Controller, Get, Patch } from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { UpdateHospitalDto } from './dto/update-hospital.dto';
import { HospitalsService } from './hospitals.service';

@Controller('hospitals')
export class HospitalsController {
  constructor(private readonly hospitals: HospitalsService) {}

  @Get('me')
  getMine(@CurrentUser() user: AuthUser) {
    return this.hospitals.getMine(user.hospitalId);
  }

  @Roles('HOSPITAL_ADMIN')
  @Patch('me')
  updateMine(@CurrentUser() user: AuthUser, @Body() dto: UpdateHospitalDto) {
    return this.hospitals.updateMine(user.hospitalId, dto);
  }
}