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
import { ConsultationsService } from './consultations.service';
import { CreateConsultationDto } from './dto/create-consultation.dto';

@Controller('consultations')
export class ConsultationsController {
  constructor(private readonly consultations: ConsultationsService) {}

  @Roles('DOCTOR')
  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateConsultationDto) {
    return this.consultations.create(user.hospitalId, user.userId, dto);
  }

  @Roles('DOCTOR', 'NURSE')
  @Get('patient/:patientId')
  listForPatient(
    @CurrentUser() user: AuthUser,
    @Param('patientId', ParseUUIDPipe) patientId: string,
  ) {
    return this.consultations.listForPatient(
      user.hospitalId,
      user.userId,
      patientId,
    );
  }
}