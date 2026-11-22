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
import { CreateLabOrderDto } from './dto/create-lab-order.dto';
import { EnterResultDto } from './dto/enter-result.dto';
import { UpdateLabStatusDto } from './dto/update-lab-status.dto';
import { LaboratoryService } from './laboratory.service';

@Controller('lab-orders')
export class LaboratoryController {
  constructor(private readonly lab: LaboratoryService) {}

  @Roles('DOCTOR')
  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateLabOrderDto) {
    return this.lab.create(user.hospitalId, user.userId, dto);
  }

  @Roles('LAB_TECH')
  @Get('queue')
  queue(@CurrentUser() user: AuthUser) {
    return this.lab.queue(user.hospitalId);
  }

  @Roles('DOCTOR', 'NURSE')
  @Get('patient/:patientId')
  listForPatient(
    @CurrentUser() user: AuthUser,
    @Param('patientId', ParseUUIDPipe) patientId: string,
  ) {
    return this.lab.listForPatient(user.hospitalId, user.userId, patientId);
  }

  @Roles('LAB_TECH')
  @Patch(':id/status')
  setStatus(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateLabStatusDto,
  ) {
    return this.lab.setStatus(user.hospitalId, user.userId, id, dto);
  }

  @Roles('LAB_TECH')
  @Patch(':id/result')
  enterResult(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EnterResultDto,
  ) {
    return this.lab.enterResult(user.hospitalId, user.userId, id, dto);
  }
}