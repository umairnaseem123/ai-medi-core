import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../database/prisma.service';
import { CreateLabOrderDto } from './dto/create-lab-order.dto';
import { EnterResultDto } from './dto/enter-result.dto';
import { UpdateLabStatusDto } from './dto/update-lab-status.dto';

@Injectable()
export class LaboratoryService {
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
    dto: CreateLabOrderDto,
  ) {
    const hid = this.requireHospital(hospitalId);
    const patient = await this.prisma.patient.findFirst({
      where: { id: dto.patientId, hospitalId: hid },
    });
    if (!patient) throw new BadRequestException('Invalid patient');

    const order = await this.prisma.labOrder.create({
      data: {
        hospitalId: hid,
        patientId: dto.patientId,
        orderedById: doctorId,
        testName: dto.testName,
        priority: dto.priority,
      },
    });
    await this.audit.log({
      hospitalId: hid,
      userId: doctorId,
      action: 'CREATE',
      entity: 'LabOrder',
      entityId: order.id,
    });
    return order;
  }

  // Lab queue: open orders for the whole hospital
  async queue(hospitalId: string | null) {
    return this.prisma.labOrder.findMany({
      where: {
        hospitalId: this.requireHospital(hospitalId),
        status: { in: ['ORDERED', 'IN_PROGRESS'] },
      },
      include: {
        patient: {
          select: { id: true, firstName: true, lastName: true, mrn: true },
        },
      },
      orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
      take: 200,
    });
  }

  async listForPatient(
    hospitalId: string | null,
    userId: string,
    patientId: string,
  ) {
    const hid = this.requireHospital(hospitalId);
    // Ownership check first: another hospital's patient looks like "not found"
    const patient = await this.prisma.patient.findFirst({
      where: { id: patientId, hospitalId: hid },
    });
    if (!patient) throw new NotFoundException('Patient not found');

    const orders = await this.prisma.labOrder.findMany({
      where: { hospitalId: hid, patientId },
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
    return orders;
  }

  private async findOwned(hospitalId: string | null, id: string) {
    const order = await this.prisma.labOrder.findFirst({
      where: { id, hospitalId: this.requireHospital(hospitalId) },
    });
    if (!order) throw new NotFoundException('Lab order not found');
    return order;
  }

  async setStatus(
    hospitalId: string | null,
    userId: string,
    id: string,
    dto: UpdateLabStatusDto,
  ) {
    const order = await this.findOwned(hospitalId, id);
    if (order.status === 'COMPLETED' || order.status === 'CANCELLED') {
      throw new ConflictException('Order is already closed');
    }
    const updated = await this.prisma.labOrder.update({
      where: { id },
      data: { status: dto.status },
    });
    await this.audit.log({
      hospitalId,
      userId,
      action: 'UPDATE',
      entity: 'LabOrder',
      entityId: id,
    });
    return updated;
  }

  async enterResult(
    hospitalId: string | null,
    userId: string,
    id: string,
    dto: EnterResultDto,
  ) {
    const order = await this.findOwned(hospitalId, id);
    if (order.status === 'COMPLETED' || order.status === 'CANCELLED') {
      throw new ConflictException('Order is already closed');
    }
    const updated = await this.prisma.labOrder.update({
      where: { id },
      data: {
        result: dto.result,
        resultById: userId,
        resultAt: new Date(),
        status: 'COMPLETED',
      },
    });
    await this.audit.log({
      hospitalId,
      userId,
      action: 'UPDATE',
      entity: 'LabOrder',
      entityId: id,
    });
    return updated;
  }
  async release(hospitalId: string | null, userId: string, id: string) {
    const order = await this.findOwned(hospitalId, id);
    if (order.status !== 'COMPLETED') {
      throw new ConflictException('Only a completed result can be released');
    }

    // Succeeds only while the result is still unreleased
    const done = await this.prisma.labOrder.updateMany({
      where: {
        id,
        hospitalId: order.hospitalId,
        status: 'COMPLETED',
        releasedAt: null,
      },
      data: { releasedAt: new Date(), releasedById: userId },
    });
    if (done.count === 0) {
      throw new ConflictException('Result is already released');
    }

    await this.audit.log({
      hospitalId: order.hospitalId,
      userId,
      action: 'UPDATE',
      entity: 'LabOrder',
      entityId: id,
    });
    return this.prisma.labOrder.findUniqueOrThrow({ where: { id } });
  }
}