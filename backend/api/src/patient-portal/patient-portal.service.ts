import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../database/prisma.service';
import { CreatePatientLoginDto } from './dto/create-patient-login.dto';

@Injectable()
export class PatientPortalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private requireHospital(hospitalId: string | null): string {
    if (!hospitalId) throw new ForbiddenException('No hospital assigned');
    return hospitalId;
  }

  async createLogin(
    hospitalId: string | null,
    actorId: string,
    patientId: string,
    dto: CreatePatientLoginDto,
  ) {
    const hid = this.requireHospital(hospitalId);
    const patient = await this.prisma.patient.findFirst({
      where: { id: patientId, hospitalId: hid },
    });
    if (!patient) throw new NotFoundException('Patient not found');
    if (patient.userId) {
      throw new ConflictException('Patient already has a login');
    }

    const email = dto.email.toLowerCase();
    if (await this.prisma.user.findUnique({ where: { email } })) {
      throw new ConflictException('Email already registered');
    }
    const passwordHash = await bcrypt.hash(dto.password, 12);

    let user;
    try {
      user = await this.prisma.$transaction(async (tx) => {
        const created = await tx.user.create({
          data: {
            hospitalId: hid,
            email,
            passwordHash,
            firstName: patient.firstName,
            lastName: patient.lastName,
            role: 'PATIENT',
          },
          select: { id: true, email: true, role: true },
        });
        // Only succeeds while the patient still has no login
        const linked = await tx.patient.updateMany({
          where: { id: patientId, hospitalId: hid, userId: null },
          data: { userId: created.id },
        });
        if (linked.count === 0) {
          throw new ConflictException('Patient already has a login');
        }
        return created;
      });
    } catch (e) {
      if ((e as { code?: string })?.code === 'P2002') {
        throw new ConflictException('Email already registered');
      }
      throw e;
    }

    await this.audit.log({
      hospitalId: hid,
      userId: actorId,
      action: 'CREATE',
      entity: 'User',
      entityId: user.id,
    });
    return user;
  }
}