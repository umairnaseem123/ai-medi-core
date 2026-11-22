import { AuditModule } from './audit/audit.module';
import { ConsultationsModule } from './consultations/consultations.module';
import { HospitalsModule } from './hospitals/hospitals.module';
import { DepartmentsModule } from './departments/departments.module';
import { AppointmentsModule } from './appointments/appointments.module';
import { StaffModule } from './staff/staff.module';
import { PatientsModule } from './patients/patients.module';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import configuration from './config/configuration';
import { validationSchema } from './config/validation';
import { PrismaModule } from './database/prisma.module';
import { HealthModule } from './health/health.module';


@Module({
   imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validationSchema,
    }),
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
  ],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}