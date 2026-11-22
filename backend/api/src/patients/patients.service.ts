import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomBytes } from 'crypto';
import { PrismaService } from '../database/prisma.service';
import { CreatePatientDto } from './dto/create-patient.dto';
import { UpdatePatientDto } from './dto/update-patient.dto';

@Injectable()
export class PatientsService {
  constructor(private readonly prisma: PrismaService) {}

  private requireHospital(hospitalId: string | null): string {
    if (!hospitalId) throw new ForbiddenException('No hospital assigned');
    return hospitalId;
  }

  async list(hospitalId: string | null, search?: string) {
    const hid = this.requireHospital(hospitalId);
    const term = search?.trim();
    return this.prisma.patient.findMany({
      where: {
        hospitalId: hid,
        ...(term
          ? {
              OR: [
                { firstName: { contains: term, mode: 'insensitive' } },
                { lastName: { contains: term, mode: 'insensitive' } },
                { mrn: { contains: term, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async get(hospitalId: string | null, id: string) {
    const patient = await this.prisma.patient.findFirst({
      where: { id, hospitalId: this.requireHospital(hospitalId) },
    });
    if (!patient) throw new NotFoundException('Patient not found');
    return patient;
  }

  async create(hospitalId: string | null, dto: CreatePatientDto) {
    const hid = this.requireHospital(hospitalId);
    // Retry a few times in the unlikely case of an MRN collision
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.prisma.patient.create({
          data: {
            ...dto,
            dateOfBirth: new Date(dto.dateOfBirth),
            hospitalId: hid,
            mrn: `MRN-${randomBytes(4).toString('hex').toUpperCase()}`,
          },
        });
      } catch (e) {
        const duplicate =
          e instanceof Prisma.PrismaClientKnownRequestError &&
          e.code === 'P2002';
        if (!duplicate || attempt === 2) throw e;
      }
    }
    throw new ConflictException('Could not generate a unique MRN');
  }

  async update(hospitalId: string | null, id: string, dto: UpdatePatientDto) {
    await this.get(hospitalId, id);
    const { dateOfBirth, ...rest } = dto;
    return this.prisma.patient.update({
      where: { id },
      data: {
        ...rest,
        ...(dateOfBirth ? { dateOfBirth: new Date(dateOfBirth) } : {}),
      },
    });
  }
}