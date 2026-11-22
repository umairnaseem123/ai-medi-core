import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  // Logs who did what to which record. Never store clinical content here.
  async log(params: {
    hospitalId: string | null;
    userId: string;
    action: 'READ' | 'CREATE' | 'UPDATE';
    entity: string;
    entityId: string;
  }) {
    await this.prisma.auditLog.create({ data: params });
  }
}