import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../database/prisma.service';
import { CreatePrescriptionDto } from './dto/create-prescription.dto';
import { UpdatePrescriptionStatusDto } from './dto/update-prescription-status.dto';

@Injectable()
export class PharmacyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private requireHospital(hospitalId: string | null): string {
    if (!hospitalId) throw new ForbiddenException('No hospital assigned');
    return hospitalId;
  }

  async create(
    hospitalId: string | null,
    doctorId: string,
    dto: CreatePrescriptionDto,
  ) {
    const hid = this.requireHospital(hospitalId);
    const patient = await this.prisma.patient.findFirst({
      where: { id: dto.patientId, hospitalId: hid },
    });
    if (!patient) throw new BadRequestException('Invalid patient');

    const prescription = await this.prisma.prescription.create({
      data: {
        hospitalId: hid,
        patientId: dto.patientId,
        prescriberId: doctorId,
        notes: dto.notes,
        items: { create: dto.items },
      },
      include: { items: true },
    });
    await this.audit.log({
      hospitalId: hid,
      userId: doctorId,
      action: 'CREATE',
      entity: 'Prescription',
      entityId: prescription.id,
    });
    return prescription;
  }

  async queue(hospitalId: string | null) {
    return this.prisma.prescription.findMany({
      where: {
        hospitalId: this.requireHospital(hospitalId),
        status: 'PENDING',
      },
      include: {
        items: true,
        patient: {
          select: { id: true, firstName: true, lastName: true, mrn: true },
        },
      },
      orderBy: { createdAt: 'asc' },
      take: 200,
    });
  }

  async listForPatient(
    hospitalId: string | null,
    userId: string,
    patientId: string,
  ) {
    const hid = this.requireHospital(hospitalId);
    const patient = await this.prisma.patient.findFirst({
      where: { id: patientId, hospitalId: hid },
    });
    if (!patient) throw new NotFoundException('Patient not found');

    const list = await this.prisma.prescription.findMany({
      where: { hospitalId: hid, patientId },
      include: { items: true },
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

  async setStatus(
    hospitalId: string | null,
    userId: string,
    id: string,
    dto: UpdatePrescriptionStatusDto,
  ) {
    const hid = this.requireHospital(hospitalId);
    const rx = await this.prisma.prescription.findFirst({
      where: { id, hospitalId: hid },
    });
    if (!rx) throw new NotFoundException('Prescription not found');
    if (rx.status !== 'PENDING') {
      throw new ConflictException('Prescription is already closed');
    }

    const updated = await this.prisma.prescription.update({
      where: { id },
      data:
        dto.status === 'DISPENSED'
          ? { status: 'DISPENSED', dispensedById: userId, dispensedAt: new Date() }
          : { status: 'CANCELLED' },
      include: { items: true },
    });
    await this.audit.log({
      hospitalId: hid,
      userId,
      action: 'UPDATE',
      entity: 'Prescription',
      entityId: id,
    });
    return updated;
  }
}