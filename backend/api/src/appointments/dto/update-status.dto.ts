import { IsIn } from 'class-validator';

export const APPOINTMENT_STATUSES = [
  'SCHEDULED',
  'COMPLETED',
  'CANCELLED',
  'NO_SHOW',
] as const;

export class UpdateStatusDto {
  @IsIn(APPOINTMENT_STATUSES)
  status: (typeof APPOINTMENT_STATUSES)[number];
}