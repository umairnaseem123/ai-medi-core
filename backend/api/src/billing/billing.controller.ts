import { Body, Controller, Get, Post } from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { BillingService } from './billing.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';

@Controller('invoices')
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Roles('HOSPITAL_ADMIN', 'RECEPTIONIST')
  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateInvoiceDto) {
    return this.billing.create(user.hospitalId, user.userId, dto);
  }

  @Roles('HOSPITAL_ADMIN', 'RECEPTIONIST')
  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.billing.list(user.hospitalId);
  }
}