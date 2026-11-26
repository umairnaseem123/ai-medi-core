import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { CareRecordsService } from './care-records.service';
import { CreateCareRecordDto } from './dto/create-care-record.dto';

@Controller('care-records')
export class CareRecordsController {
  constructor(private readonly records: CareRecordsService) {}

  @Roles('DOCTOR', 'NURSE')
  @Post('patient/:patientId')
  create(
    @CurrentUser() user: AuthUser,
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @Body() dto: CreateCareRecordDto,
  ) {
    return this.records.create(user.hospitalId, user.userId, patientId, dto);
  }

  @Roles('DOCTOR', 'NURSE')
  @Get('patient/:patientId')
  list(
    @CurrentUser() user: AuthUser,
    @Param('patientId', ParseUUIDPipe) patientId: string,
  ) {
    return this.records.list(user.hospitalId, user.userId, patientId);
  }
}