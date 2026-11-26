import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../database/prisma.service';
import { UpsertMedicalRecordDto } from './dto/upsert-medical-record.dto';

const RECORD_SELECT = {
  patientId: true,
  bloodGroup: true,
  allergies: true,
  chronicConditions: true,
  familyHistory: true,
  updatedAt: true,
} as const;

@Injectable()
export class MedicalRecordsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private requireHospital(hospitalId: string | null): string {
    if (!hospitalId) throw new ForbiddenException('No hospital assigned');
    return hospitalId;
  }

  private async requirePatient(hid: string, patientId: string) {
    const patient = await this.prisma.patient.findFirst({
      where: { id: patientId, hospitalId: hid },
    });
    if (!patient) throw new NotFoundException('Patient not found');
  }

  async get(hospitalId: string | null, userId: string, patientId: string) {
    const hid = this.requireHospital(hospitalId);
    await this.requirePatient(hid, patientId);

    const record = await this.prisma.medicalRecord.findFirst({
      where: { patientId, hospitalId: hid },
      select: RECORD_SELECT,
    });
    await this.audit.log({
      hospitalId: hid,
      userId,
      action: 'READ',
      entity: 'Patient',
      entityId: patientId,
    });
    return (
      record ?? {
        patientId,
        bloodGroup: null,
        allergies: null,
        chronicConditions: null,
        familyHistory: null,
        updatedAt: null,
      }
    );
  }

  async upsert(
    hospitalId: string | null,
    userId: string,
    patientId: string,
    dto: UpsertMedicalRecordDto,
  ) {
    const hid = this.requireHospital(hospitalId);
    await this.requirePatient(hid, patientId);

    const data = {
      bloodGroup: dto.bloodGroup,
      allergies: dto.allergies,
      chronicConditions: dto.chronicConditions,
      familyHistory: dto.familyHistory,
      updatedById: userId,
    };
    const record = await this.prisma.medicalRecord.upsert({
      where: { patientId },
      create: { hospitalId: hid, patientId, ...data },
      update: data,
      select: RECORD_SELECT,
    });
    await this.audit.log({
      hospitalId: hid,
      userId,
      action: 'UPDATE',
      entity: 'MedicalRecord',
      entityId: patientId,
    });
    return record;
  }
}