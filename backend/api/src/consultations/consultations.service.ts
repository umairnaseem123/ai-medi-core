import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../database/prisma.service';
import { CreateConsultationDto } from './dto/create-consultation.dto';

@Injectable()
export class ConsultationsService {
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
    dto: CreateConsultationDto,
  ) {
    const hid = this.requireHospital(hospitalId);

    const patient = await this.prisma.patient.findFirst({
      where: { id: dto.patientId, hospitalId: hid },
    });
    if (!patient) throw new BadRequestException('Invalid patient');

    if (dto.appointmentId) {
      const appt = await this.prisma.appointment.findFirst({
        where: {
          id: dto.appointmentId,
          hospitalId: hid,
          patientId: dto.patientId,
        },
      });
      if (!appt) throw new BadRequestException('Invalid appointment');
    }

    const record = await this.prisma.consultation.create({
      data: { ...dto, hospitalId: hid, doctorId },
    });
    await this.audit.log({
      hospitalId: hid,
      userId: doctorId,
      action: 'CREATE',
      entity: 'Consultation',
      entityId: record.id,
    });
    return record;
  }

  async listForPatient(
    hospitalId: string | null,
    userId: string,
    patientId: string,
  ) {
    const hid = this.requireHospital(hospitalId);
    const records = await this.prisma.consultation.findMany({
      where: { hospitalId: hid, patientId },
      include: {
        doctor: { select: { id: true, firstName: true, lastName: true } },
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
    return records;
  }
}