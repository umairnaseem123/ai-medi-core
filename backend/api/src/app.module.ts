import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppointmentsModule } from './appointments/appointments.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import configuration from './config/configuration';
import { validationSchema } from './config/validation';
import { ConsultationsModule } from './consultations/consultations.module';
import { PrismaModule } from './database/prisma.module';
import { DepartmentsModule } from './departments/departments.module';
import { HealthModule } from './health/health.module';
import { HospitalsModule } from './hospitals/hospitals.module';
import { InventoryModule } from './inventory/inventory.module';
import { LaboratoryModule } from './laboratory/laboratory.module';
import { PatientsModule } from './patients/patients.module';
import { PharmacyModule } from './pharmacy/pharmacy.module';
import { StaffModule } from './staff/staff.module';
import { BillingModule } from './billing/billing.module';
import { WardsModule } from './wards/wards.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validationSchema,
    }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
    PrismaModule,
    AuthModule,
    HealthModule,
    HospitalsModule,
    DepartmentsModule,
    StaffModule,
    PatientsModule,
    AppointmentsModule,
    AuditModule,
    ConsultationsModule,
    LaboratoryModule,
    PharmacyModule,
    InventoryModule,
        BillingModule,
        WardsModule,
  ],
  providers: [
    // Throttle first, so abusive traffic is rejected before auth work
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}