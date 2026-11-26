import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../database/prisma.service';
import { CreateBedDto } from './dto/create-bed.dto';
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
}