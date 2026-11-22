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
import { CreateMedicineDto } from './dto/create-medicine.dto';
import { ReceiveStockDto } from './dto/receive-stock.dto';
import { InventoryService } from './inventory.service';

@Controller('inventory')
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  @Roles('PHARMACIST', 'HOSPITAL_ADMIN')
  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.inventory.list(user.hospitalId);
  }

  @Roles('PHARMACIST')
  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateMedicineDto) {
    return this.inventory.create(user.hospitalId, dto);
  }

  @Roles('PHARMACIST')
  @Post(':id/receive')
  receive(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReceiveStockDto,
  ) {
    return this.inventory.receive(user.hospitalId, user.userId, id, dto);
  }
}