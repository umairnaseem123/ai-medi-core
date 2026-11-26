import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../database/prisma.service';
import { CreateBedDto } from './dto/create-bed.dto';
import { AdmitPatientDto } from './dto/admit-patient.dto';
import { CreateWardDto } from './dto/create-ward.dto';

@Injectable()
export class WardsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private requireHospital(hospitalId: string | null): string {
    if (!hospitalId) throw new ForbiddenException('No hospital assigned');
    return hospitalId;
  }

  private isDuplicate(e: unknown): boolean {
    return (e as { code?: string })?.code === 'P2002';
  }

  async createWard(
    hospitalId: string | null,
    userId: string,
    dto: CreateWardDto,
  ) {
    const hid = this.requireHospital(hospitalId);
    try {
      const ward = await this.prisma.ward.create({
        data: {
          hospitalId: hid,
          name: dto.name.trim(),
          description: dto.description,
        },
      });
      await this.audit.log({
        hospitalId: hid,
        userId,
        action: 'CREATE',
        entity: 'Ward',
        entityId: ward.id,
      });
      return ward;
    } catch (e) {
      if (this.isDuplicate(e)) {
        throw new ConflictException('A ward with this name already exists');
      }
      throw e;
    }
  }

  async createBed(
    hospitalId: string | null,
    userId: string,
    wardId: string,
    dto: CreateBedDto,
  ) {
    const hid = this.requireHospital(hospitalId);
    const ward = await this.prisma.ward.findFirst({
      where: { id: wardId, hospitalId: hid },
    });
    if (!ward) throw new NotFoundException('Ward not found');

    try {
      const bed = await this.prisma.bed.create({
        data: { hospitalId: hid, wardId, label: dto.label.trim() },
      });
      await this.audit.log({
        hospitalId: hid,
        userId,
        action: 'CREATE',
        entity: 'Bed',
        entityId: bed.id,
      });
      return bed;
    } catch (e) {
      if (this.isDuplicate(e)) {
        throw new ConflictException('This ward already has a bed with that label');
      }
      throw e;
    }
  }

  list(hospitalId: string | null) {
    return this.prisma.ward.findMany({
      where: { hospitalId: this.requireHospital(hospitalId) },
      include: {
        beds: {
          select: { id: true, label: true, status: true },
          orderBy: { label: 'asc' },
        },
      },
      orderBy: { name: 'asc' },
    });
  }
  async admit(
    hospitalId: string | null,
    userId: string,
    bedId: string,
    dto: AdmitPatientDto,
  ) {
    const hid = this.requireHospital(hospitalId);

    const admission = await this.prisma.$transaction(async (tx) => {
      const bed = await tx.bed.findFirst({
        where: { id: bedId, hospitalId: hid },
      });
      if (!bed) throw new NotFoundException('Bed not found');

      const patient = await tx.patient.findFirst({
        where: { id: dto.patientId, hospitalId: hid },
      });
      if (!patient) throw new BadRequestException('Invalid patient');

      const already = await tx.admission.findFirst({
        where: { patientId: dto.patientId, hospitalId: hid, dischargedAt: null },
      });
      if (already) {
        throw new ConflictException('Patient is already admitted');
      }

      // Claim the bed: only succeeds while it is still available
      const claimed = await tx.bed.updateMany({
        where: { id: bedId, hospitalId: hid, status: 'AVAILABLE' },
        data: { status: 'OCCUPIED' },
      });
      if (claimed.count === 0) {
        throw new ConflictException('Bed is not available');
      }

      return tx.admission.create({
        data: {
          hospitalId: hid,
          patientId: dto.patientId,
          bedId,
          admittedById: userId,
          notes: dto.notes,
        },
      });
    });

    await this.audit.log({
      hospitalId: hid,
      userId,
      action: 'CREATE',
      entity: 'Admission',
      entityId: admission.id,
    });
    return admission;
  }

  async discharge(
    hospitalId: string | null,
    userId: string,
    admissionId: string,
  ) {
    const hid = this.requireHospital(hospitalId);

    const result = await this.prisma.$transaction(async (tx) => {
      const adm = await tx.admission.findFirst({
        where: { id: admissionId, hospitalId: hid },
      });
      if (!adm) throw new NotFoundException('Admission not found');

      // Only succeeds if the patient has not been discharged yet
      const closed = await tx.admission.updateMany({
        where: { id: admissionId, hospitalId: hid, dischargedAt: null },
        data: { dischargedAt: new Date() },
      });
      if (closed.count === 0) {
        throw new ConflictException('Patient is already discharged');
      }

      await tx.bed.update({
        where: { id: adm.bedId },
        data: { status: 'AVAILABLE' },
      });

      return tx.admission.findUniqueOrThrow({ where: { id: admissionId } });
    });

    await this.audit.log({
      hospitalId: hid,
      userId,
      action: 'UPDATE',
      entity: 'Admission',
      entityId: admissionId,
    });
    return result;
  }
}