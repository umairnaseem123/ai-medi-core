import { IsIn } from 'class-validator';

export const PHARMACY_STATUS_UPDATES = ['DISPENSED', 'CANCELLED'] as const;

export class UpdatePrescriptionStatusDto {
  @IsIn(PHARMACY_STATUS_UPDATES)
  status: (typeof PHARMACY_STATUS_UPDATES)[number];
}