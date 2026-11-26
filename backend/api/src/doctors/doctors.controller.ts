import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Put,
} from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { UpsertDoctorProfileDto } from './dto/upsert-doctor-profile.dto';
import { DoctorsService } from './doctors.service';

@Controller('doctors')
export class DoctorsController {
  constructor(private readonly doctors: DoctorsService) {}

  @Roles('HOSPITAL_ADMIN', 'DOCTOR', 'NURSE', 'RECEPTIONIST')
  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.doctors.list(user.hospitalId);
  }

  // Declared before ':userId' so "me" is never parsed as an id
  @Roles('DOCTOR')
  @Put('me')
  updateMine(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpsertDoctorProfileDto,
  ) {
    return this.doctors.upsert(user.hospitalId, user.userId, user.userId, dto);
  }

  @Roles('HOSPITAL_ADMIN')
  @Put(':userId')
  updateOne(
    @CurrentUser() user: AuthUser,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: UpsertDoctorProfileDto,
  ) {
    return this.doctors.upsert(user.hospitalId, user.userId, userId, dto);
  }
}