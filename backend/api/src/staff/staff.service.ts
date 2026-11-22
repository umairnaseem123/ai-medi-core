import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../database/prisma.service';
import { CreateStaffDto } from './dto/create-staff.dto';

const SAFE_SELECT = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  role: true,
  status: true,
  departmentId: true,
  createdAt: true,
} as const;

@Injectable()
export class StaffService {
  constructor(private readonly prisma: PrismaService) {}

  private requireHospital(hospitalId: string | null): string {
    if (!hospitalId) throw new ForbiddenException('No hospital assigned');
    return hospitalId;
  }

  list(hospitalId: string | null) {
    return this.prisma.user.findMany({
      where: { hospitalId: this.requireHospital(hospitalId) },
      select: SAFE_SELECT,
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(hospitalId: string | null, dto: CreateStaffDto) {
    const hid = this.requireHospital(hospitalId);
    const email = dto.email.toLowerCase();

    if (await this.prisma.user.findUnique({ where: { email } })) {
      throw new ConflictException('Email already registered');
    }

    if (dto.departmentId) {
      const dept = await this.prisma.department.findFirst({
        where: { id: dto.departmentId, hospitalId: hid },
      });
      if (!dept) throw new BadRequestException('Invalid department');
    }

    return this.prisma.user.create({
      data: {
        hospitalId: hid,
        departmentId: dto.departmentId,
        email,
        passwordHash: await bcrypt.hash(dto.password, 12),
        firstName: dto.firstName,
        lastName: dto.lastName,
        role: dto.role,
      },
      select: SAFE_SELECT,
    });
  }

  async setStatus(
    hospitalId: string | null,
    id: string,
    status: 'ACTIVE' | 'SUSPENDED',
  ) {
    const user = await this.prisma.user.findFirst({
      where: { id, hospitalId: this.requireHospital(hospitalId) },
    });
    if (!user) throw new NotFoundException('Staff member not found');
    if (user.role === 'HOSPITAL_ADMIN') {
      throw new ForbiddenException('Cannot change an admin account here');
    }
    return this.prisma.user.update({
      where: { id },
      data: { status },
      select: SAFE_SELECT,
    });
  }
}