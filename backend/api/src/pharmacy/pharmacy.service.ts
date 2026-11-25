import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../database/prisma.service';
import { CreatePrescriptionDto } from './dto/create-prescription.dto';
import { UpdatePrescriptionStatusDto } from './dto/update-prescription-status.dto';

@Injectable()
export class PharmacyService {
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
    dto: CreatePrescriptionDto,
  ) {
    const hid = this.requireHospital(hospitalId);
    const patient = await this.prisma.patient.findFirst({
      where: { id: dto.patientId, hospitalId: hid },
    });
    if (!patient) throw new BadRequestException('Invalid patient');

    const prescription = await this.prisma.prescription.create({
      data: {
        hospitalId: hid,
        patientId: dto.patientId,
        prescriberId: doctorId,
        notes: dto.notes,
        items: { create: dto.items },
      },
      include: { items: true },
    });
    await this.audit.log({
      hospitalId: hid,
      userId: doctorId,
      action: 'CREATE',
      entity: 'Prescription',
      entityId: prescription.id,
    });
    return prescription;
  }

  async queue(hospitalId: string | null) {
    return this.prisma.prescription.findMany({
      where: {
        hospitalId: this.requireHospital(hospitalId),
        status: 'PENDING',
      },
      include: {
        items: true,
        patient: {
          select: { id: true, firstName: true, lastName: true, mrn: true },
        },
      },
      orderBy: { createdAt: 'asc' },
      take: 200,
    });
  }

  async listForPatient(
    hospitalId: string | null,
    userId: string,
    patientId: string,
  ) {
    const hid = this.requireHospital(hospitalId);
    const patient = await this.prisma.patient.findFirst({
      where: { id: patientId, hospitalId: hid },
    });
    if (!patient) throw new NotFoundException('Patient not found');

    const list = await this.prisma.prescription.findMany({
      where: { hospitalId: hid, patientId },
      include: { items: true },
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
    return list;
  }

  async setStatus(
    hospitalId: string | null,
    userId: string,
    id: string,
    dto: UpdatePrescriptionStatusDto,
  ) {
    const hid = this.requireHospital(hospitalId);
    const rx = await this.prisma.prescription.findFirst({
      where: { id, hospitalId: hid },
      include: { items: true },
    });
    if (!rx) throw new NotFoundException('Prescription not found');
    if (rx.status !== 'PENDING') {
      throw new ConflictException('Prescription is already closed');
    }

    let updated;
    if (dto.status === 'CANCELLED') {
      updated = await this.prisma.prescription.update({
        where: { id },
        data: { status: 'CANCELLED' },
        include: { items: true },
      });
    } else {
      // Everything below succeeds or fails together
      updated = await this.prisma.$transaction(async (tx) => {
        // Claim the prescription first so two pharmacists cannot both dispense it
        const claimed = await tx.prescription.updateMany({
          where: { id, hospitalId: hid, status: 'PENDING' },
          data: {
            status: 'DISPENSED',
            dispensedById: userId,
            dispensedAt: new Date(),
          },
        });
        if (claimed.count === 0) {
          throw new ConflictException('Prescription is already closed');
        }

        for (const item of rx.items) {
          const medicine = await tx.medicine.findFirst({
            where: {
              hospitalId: hid,
              name: { equals: item.medicine, mode: 'insensitive' },
            },
          });
          if (!medicine) {
            throw new ConflictException(
              `Medicine not in inventory: ${item.medicine}`,
            );
          }
                    // Doctor-prescribed quantity (defaults to 1 in the database)
          const qty = item.quantity;
          // Conditional decrement: only succeeds while stock is sufficient
          const deducted = await tx.medicine.updateMany({
            where: { id: medicine.id, quantity: { gte: qty } },
            data: { quantity: { decrement: qty } },
          });
          if (deducted.count === 0) {
            throw new ConflictException(
              `Insufficient stock: ${item.medicine}`,
            );
          }
          await tx.stockMovement.create({
            data: {
              hospitalId: hid,
              medicineId: medicine.id,
              userId,
              type: 'DISPENSE',
              change: -qty,
              reason: `Prescription ${id}`,
            },
          });
        }

        return tx.prescription.findUniqueOrThrow({
          where: { id },
          include: { items: true },
        });
      });
    }

    await this.audit.log({
      hospitalId: hid,
      userId,
      action: 'UPDATE',
      entity: 'Prescription',
      entityId: id,
    });
    return updated;
  }
}