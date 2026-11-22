import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { CreateMedicineDto } from './dto/create-medicine.dto';
import { ReceiveStockDto } from './dto/receive-stock.dto';

@Injectable()
export class InventoryService {
  constructor(private readonly prisma: PrismaService) {}

  private requireHospital(hospitalId: string | null): string {
    if (!hospitalId) throw new ForbiddenException('No hospital assigned');
    return hospitalId;
  }

  async list(hospitalId: string | null) {
    const medicines = await this.prisma.medicine.findMany({
      where: { hospitalId: this.requireHospital(hospitalId) },
      orderBy: { name: 'asc' },
    });
    return medicines.map((m) => ({ ...m, lowStock: m.quantity <= m.reorderAt }));
  }

  async create(hospitalId: string | null, dto: CreateMedicineDto) {
    try {
      return await this.prisma.medicine.create({
        data: { ...dto, hospitalId: this.requireHospital(hospitalId) },
      });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw new ConflictException('Medicine already exists');
      }
      throw e;
    }
  }

  async receive(
    hospitalId: string | null,
    userId: string,
    id: string,
    dto: ReceiveStockDto,
  ) {
    const hid = this.requireHospital(hospitalId);
    const medicine = await this.prisma.medicine.findFirst({
      where: { id, hospitalId: hid },
    });
    if (!medicine) throw new NotFoundException('Medicine not found');

    const [updated] = await this.prisma.$transaction([
      this.prisma.medicine.update({
        where: { id },
        data: { quantity: { increment: dto.quantity } },
      }),
      this.prisma.stockMovement.create({
        data: {
          hospitalId: hid,
          medicineId: id,
          userId,
          type: 'RECEIVE',
          change: dto.quantity,
          reason: dto.reason,
        },
      }),
    ]);
    return updated;
  }
}