import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../database/prisma.service';
import { UpsertDoctorProfileDto } from './dto/upsert-doctor-profile.dto';

@Injectable()
export class DoctorsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private requireHospital(hospitalId: string | null): string {
    if (!hospitalId) throw new ForbiddenException('No hospital assigned');
    return hospitalId;
  }

  list(hospitalId: string | null) {
    return this.prisma.user.findMany({
      where: { hospitalId: this.requireHospital(hospitalId), role: 'DOCTOR' },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        status: true,
        departmentId: true,
        doctorProfile: {
          select: { specialization: true, licenseNumber: true, bio: true },
        },
      },
      orderBy: { lastName: 'asc' },
    });
  }

  async upsert(
    hospitalId: string | null,
    actorId: string,
    doctorUserId: string,
    dto: UpsertDoctorProfileDto,
  ) {
    const hid = this.requireHospital(hospitalId);
    const doctor = await this.prisma.user.findFirst({
      where: { id: doctorUserId, hospitalId: hid, role: 'DOCTOR' },
    });
    if (!doctor) throw new NotFoundException('Doctor not found');

    const data = {
      specialization: dto.specialization.trim(),
      licenseNumber: dto.licenseNumber,
      bio: dto.bio,
    };
    const profile = await this.prisma.doctorProfile.upsert({
      where: { userId: doctorUserId },
      create: { hospitalId: hid, userId: doctorUserId, ...data },
      update: data,
      select: {
        userId: true,
        specialization: true,
        licenseNumber: true,
        bio: true,
      },
    });
    await this.audit.log({
      hospitalId: hid,
      userId: actorId,
      action: 'UPDATE',
      entity: 'DoctorProfile',
      entityId: doctorUserId,
    });
    return profile;
  }
}