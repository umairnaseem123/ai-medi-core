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
import { CreateBedDto } from './dto/create-bed.dto';
import { CreateWardDto } from './dto/create-ward.dto';
import { WardsService } from './wards.service';

@Controller('wards')
export class WardsController {
  constructor(private readonly wards: WardsService) {}

  @Roles('HOSPITAL_ADMIN')
  @Post()
  createWard(@CurrentUser() user: AuthUser, @Body() dto: CreateWardDto) {
    return this.wards.createWard(user.hospitalId, user.userId, dto);
  }

  @Roles('HOSPITAL_ADMIN')
  @Post(':id/beds')
  createBed(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateBedDto,
  ) {
    return this.wards.createBed(user.hospitalId, user.userId, id, dto);
  }

  @Roles('HOSPITAL_ADMIN', 'DOCTOR', 'NURSE', 'RECEPTIONIST')
  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.wards.list(user.hospitalId);
  }
}