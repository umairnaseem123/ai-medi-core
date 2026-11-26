import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../database/prisma.service';
import { CreateCareRecordDto } from './dto/create-care-record.dto';

const RECORD_SELECT = {
  id: true,
  patientId: true,
  systolic: true,
  diastolic: true,
  pulse: true,
  temperatureC: true,
  oxygenSat: true,
  note: true,
  createdAt: true,
  recordedBy: { select: { id: true, firstName: true, lastName: true, role: true } },
} as const;

@Injectable()
export class CareRecordsService {
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

  async create(
    hospitalId: string | null,
    userId: string,
    patientId: string,
    dto: CreateCareRecordDto,
  ) {
    const hid = this.requireHospital(hospitalId);
    await this.requirePatient(hid, patientId);

    const hasBp = dto.systolic !== undefined || dto.diastolic !== undefined;
    if (hasBp && (dto.systolic === undefined || dto.diastolic === undefined)) {
      throw new BadRequestException('Blood pressure needs systolic and diastolic');
    }
    if (hasBp && dto.diastolic! >= dto.systolic!) {
      throw new BadRequestException('Diastolic must be lower than systolic');
    }
    const hasAny =
      hasBp ||
      dto.pulse !== undefined ||
      dto.temperatureC !== undefined ||
      dto.oxygenSat !== undefined ||
      (dto.note !== undefined && dto.note.trim() !== '');
    if (!hasAny) {
      throw new BadRequestException('Record at least one vital or a note');
    }

    const record = await this.prisma.careRecord.create({
      data: {
        hospitalId: hid,
        patientId,
        recordedById: userId,
        systolic: dto.systolic,
        diastolic: dto.diastolic,
        pulse: dto.pulse,
        temperatureC: dto.temperatureC,
        oxygenSat: dto.oxygenSat,
        note: dto.note,
      },
      select: RECORD_SELECT,
    });
    await this.audit.log({
      hospitalId: hid,
      userId,
      action: 'CREATE',
      entity: 'CareRecord',
      entityId: record.id,
    });
    return record;
  }

  async list(hospitalId: string | null, userId: string, patientId: string) {
    const hid = this.requireHospital(hospitalId);
    await this.requirePatient(hid, patientId);

    const list = await this.prisma.careRecord.findMany({
      where: { hospitalId: hid, patientId },
      select: RECORD_SELECT,
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