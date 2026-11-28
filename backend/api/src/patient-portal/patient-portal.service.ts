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
  private async ownPatient(hospitalId: string | null, userId: string) {
    const hid = this.requireHospital(hospitalId);
    const patient = await this.prisma.patient.findFirst({
      where: { userId, hospitalId: hid },
      select: { id: true },
    });
    if (!patient) {
      throw new NotFoundException('No patient record is linked to this login');
    }
    return { hid, patientId: patient.id };
  }

  async myAppointments(hospitalId: string | null, userId: string) {
    const { hid, patientId } = await this.ownPatient(hospitalId, userId);
    const list = await this.prisma.appointment.findMany({
      where: { hospitalId: hid, patientId },
      select: {
        id: true,
        startsAt: true,
        endsAt: true,
        reason: true,
        status: true,
        doctor: { select: { firstName: true, lastName: true } },
      },
      orderBy: { startsAt: 'desc' },
      take: 100,
    });
    await this.audit.log({
      hospitalId: hid,
      userId,
      action: 'READ',
      entity: 'Patient',
      entityId: patientId,
    });
    return list;
  }

  async myPrescriptions(hospitalId: string | null, userId: string) {
    const { hid, patientId } = await this.ownPatient(hospitalId, userId);
    const list = await this.prisma.prescription.findMany({
      where: { hospitalId: hid, patientId },
      select: {
        id: true,
        status: true,
        createdAt: true,
        dispensedAt: true,
        items: {
          select: {
            medicine: true,
            dose: true,
            frequency: true,
            durationDays: true,
            quantity: true,
          },
        },
        prescriber: { select: { firstName: true, lastName: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    await this.audit.log({
      hospitalId: hid,
      userId,
      action: 'READ',
      entity: 'Patient',
      entityId: patientId,
    });
    return list;
  }
}