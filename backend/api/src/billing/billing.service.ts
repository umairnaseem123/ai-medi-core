import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../database/prisma.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';

const MAX_TOTAL = 2_000_000_000; // stays inside a 32-bit integer column

@Injectable()
export class BillingService {
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
    userId: string,
    dto: CreateInvoiceDto,
  ) {
    const hid = this.requireHospital(hospitalId);
    const patient = await this.prisma.patient.findFirst({
      where: { id: dto.patientId, hospitalId: hid },
    });
    if (!patient) throw new BadRequestException('Invalid patient');

    // The server computes the total, never the client
    const total = dto.items.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0);
    if (total > MAX_TOTAL) {
      throw new BadRequestException('Invoice total is too large');
    }

    const number = `INV-${Date.now().toString(36).toUpperCase()}-${Math.random()
      .toString(36)
      .slice(2, 5)
      .toUpperCase()}`;

    const invoice = await this.prisma.invoice.create({
      data: {
        hospitalId: hid,
        patientId: dto.patientId,
        number,
        total,
        createdById: userId,
        items: { create: dto.items },
      },
      include: { items: true },
    });
    await this.audit.log({
      hospitalId: hid,
      userId,
      action: 'CREATE',
      entity: 'Invoice',
      entityId: invoice.id,
    });
    return invoice;
  }

  list(hospitalId: string | null) {
    return this.prisma.invoice.findMany({
      where: { hospitalId: this.requireHospital(hospitalId) },
      include: {
        items: true,
        patient: {
          select: { id: true, firstName: true, lastName: true, mrn: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }
}