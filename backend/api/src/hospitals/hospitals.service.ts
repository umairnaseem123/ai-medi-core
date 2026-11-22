import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { UpdateHospitalDto } from './dto/update-hospital.dto';

@Injectable()
export class HospitalsService {
  constructor(private readonly prisma: PrismaService) {}

  async getMine(hospitalId: string | null) {
    if (!hospitalId) throw new ForbiddenException('No hospital assigned');
    const hospital = await this.prisma.hospital.findUnique({
      where: { id: hospitalId },
    });
    if (!hospital) throw new NotFoundException('Hospital not found');
    return hospital;
  }

  async updateMine(hospitalId: string | null, dto: UpdateHospitalDto) {
    if (!hospitalId) throw new ForbiddenException('No hospital assigned');
    return this.prisma.hospital.update({
      where: { id: hospitalId },
      data: dto,
    });
  }
}