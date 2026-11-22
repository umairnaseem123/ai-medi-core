import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { CreatePrescriptionDto } from './dto/create-prescription.dto';
import { UpdatePrescriptionStatusDto } from './dto/update-prescription-status.dto';
import { PharmacyService } from './pharmacy.service';

@Controller('prescriptions')
export class PharmacyController {
  constructor(private readonly pharmacy: PharmacyService) {}

  @Roles('DOCTOR')
  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreatePrescriptionDto) {
    return this.pharmacy.create(user.hospitalId, user.userId, dto);
  }

  @Roles('PHARMACIST')
  @Get('queue')
  queue(@CurrentUser() user: AuthUser) {
    return this.pharmacy.queue(user.hospitalId);
  }

  @Roles('DOCTOR', 'NURSE')
  @Get('patient/:patientId')
  listForPatient(
    @CurrentUser() user: AuthUser,
    @Param('patientId', ParseUUIDPipe) patientId: string,
  ) {
    return this.pharmacy.listForPatient(user.hospitalId, user.userId, patientId);
  }

  @Roles('PHARMACIST')
  @Patch(':id/status')
  setStatus(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePrescriptionStatusDto,
  ) {
    return this.pharmacy.setStatus(user.hospitalId, user.userId, id, dto);
  }
}