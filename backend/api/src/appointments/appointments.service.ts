import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { CreateAppointmentDto } from './dto/create-appointment.dto';
import { UpdateStatusDto } from './dto/update-status.dto';

@Injectable()
export class AppointmentsService {
  constructor(private readonly prisma: PrismaService) {}

  private requireHospital(hospitalId: string | null): string {
    if (!hospitalId) throw new ForbiddenException('No hospital assigned');
    return hospitalId;
  }

  list(hospitalId: string | null, doctorId?: string, date?: string) {
    const hid = this.requireHospital(hospitalId);
    const range = date
      ? {
          startsAt: {
            gte: new Date(`${date}T00:00:00.000Z`),
            lt: new Date(`${date}T23:59:59.999Z`),
          },
        }
      : {};
    return this.prisma.appointment.findMany({
      where: { hospitalId: hid, ...(doctorId ? { doctorId } : {}), ...range },
      include: {
        patient: { select: { id: true, firstName: true, lastName: true, mrn: true } },
        doctor: { select: { id: true, firstName: true, lastName: true } },
      },
      orderBy: { startsAt: 'asc' },
      take: 200,
    });
  }

  async create(hospitalId: string | null, dto: CreateAppointmentDto) {
    const hid = this.requireHospital(hospitalId);
    const startsAt = new Date(dto.startsAt);
    const endsAt = new Date(dto.endsAt);

    if (endsAt <= startsAt) {
      throw new BadRequestException('endsAt must be after startsAt');
    }

    // Both must belong to THIS hospital
    const patient = await this.prisma.patient.findFirst({
      where: { id: dto.patientId, hospitalId: hid },
    });
    if (!patient) throw new BadRequestException('Invalid patient');

    const doctor = await this.prisma.user.findFirst({
      where: {
        id: dto.doctorId,
        hospitalId: hid,
        role: 'DOCTOR',
        status: 'ACTIVE',
      },
    });
    if (!doctor) throw new BadRequestException('Invalid doctor');

    // Overlap check: existing.start < new.end AND existing.end > new.start
    const clash = await this.prisma.appointment.findFirst({
      where: {
        doctorId: dto.doctorId,
        status: 'SCHEDULED',
        startsAt: { lt: endsAt },
        endsAt: { gt: startsAt },
      },
    });
    if (clash) {
      throw new ConflictException('Doctor already has an appointment at that time');
    }

    return this.prisma.appointment.create({
      data: {
        hospitalId: hid,
        patientId: dto.patientId,
        doctorId: dto.doctorId,
        startsAt,
        endsAt,
        reason: dto.reason,
      },
    });
  }

  async setStatus(hospitalId: string | null, id: string, dto: UpdateStatusDto) {
    const appt = await this.prisma.appointment.findFirst({
      where: { id, hospitalId: this.requireHospital(hospitalId) },
    });
    if (!appt) throw new NotFoundException('Appointment not found');
    return this.prisma.appointment.update({
      where: { id },
      data: { status: dto.status },
    });
  }
}