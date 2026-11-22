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
import { CreateStaffDto } from './dto/create-staff.dto';
import { StaffService } from './staff.service';

@Roles('HOSPITAL_ADMIN')
@Controller('staff')
export class StaffController {
  constructor(private readonly staff: StaffService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.staff.list(user.hospitalId);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateStaffDto) {
    return this.staff.create(user.hospitalId, dto);
  }

  @Patch(':id/suspend')
  suspend(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.staff.setStatus(user.hospitalId, id, 'SUSPENDED');
  }

  @Patch(':id/activate')
  activate(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.staff.setStatus(user.hospitalId, id, 'ACTIVE');
  }
}