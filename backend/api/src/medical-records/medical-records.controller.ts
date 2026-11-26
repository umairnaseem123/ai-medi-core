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
import { UpsertMedicalRecordDto } from './dto/upsert-medical-record.dto';
import { MedicalRecordsService } from './medical-records.service';

@Controller('medical-records')
export class MedicalRecordsController {
  constructor(private readonly records: MedicalRecordsService) {}

  @Roles('DOCTOR', 'NURSE')
  @Get('patient/:patientId')
  get(
    @CurrentUser() user: AuthUser,
    @Param('patientId', ParseUUIDPipe) patientId: string,
  ) {
    return this.records.get(user.hospitalId, user.userId, patientId);
  }

  @Roles('DOCTOR')
  @Put('patient/:patientId')
  upsert(
    @CurrentUser() user: AuthUser,
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @Body() dto: UpsertMedicalRecordDto,
  ) {
    return this.records.upsert(user.hospitalId, user.userId, patientId, dto);
  }
}