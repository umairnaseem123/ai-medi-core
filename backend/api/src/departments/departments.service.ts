import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { CreateDepartmentDto } from './dto/create-department.dto';
import { UpdateDepartmentDto } from './dto/update-department.dto';

@Injectable()
export class DepartmentsService {
  constructor(private readonly prisma: PrismaService) {}

  private requireHospital(hospitalId: string | null): string {
    if (!hospitalId) throw new ForbiddenException('No hospital assigned');
    return hospitalId;
  }

  list(hospitalId: string | null) {
    return this.prisma.department.findMany({
      where: { hospitalId: this.requireHospital(hospitalId) },
      orderBy: { name: 'asc' },
    });
  }

  async create(hospitalId: string | null, dto: CreateDepartmentDto) {
    try {
      return await this.prisma.department.create({
        data: { ...dto, hospitalId: this.requireHospital(hospitalId) },
      });
    } catch (e) {
      this.handleUnique(e);
    }
  }

  async update(
    hospitalId: string | null,
    id: string,
    dto: UpdateDepartmentDto,
  ) {
    await this.findOwned(hospitalId, id);
    try {
      return await this.prisma.department.update({ where: { id }, data: dto });
    } catch (e) {
      this.handleUnique(e);
    }
  }

  async remove(hospitalId: string | null, id: string) {
    await this.findOwned(hospitalId, id);
    const members = await this.prisma.user.count({
      where: { departmentId: id },
    });
    if (members > 0) {
      throw new ConflictException('Department still has staff assigned');
    }
    await this.prisma.department.delete({ where: { id } });
    return { success: true };
  }

  // Tenant check: a department from another hospital looks like "not found"
  private async findOwned(hospitalId: string | null, id: string) {
    const department = await this.prisma.department.findFirst({
      where: { id, hospitalId: this.requireHospital(hospitalId) },
    });
    if (!department) throw new NotFoundException('Department not found');
    return department;
  }

  private handleUnique(e: unknown): never {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === 'P2002'
    ) {
      throw new ConflictException('A department with this name already exists');
    }
    throw e;
  }
}