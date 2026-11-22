import { IsIn } from 'class-validator';

// LAB_TECH may move an order forward or cancel it.
// COMPLETED is only set by entering a result.
export const LAB_STATUS_UPDATES = ['IN_PROGRESS', 'CANCELLED'] as const;

export class UpdateLabStatusDto {
  @IsIn(LAB_STATUS_UPDATES)
  status: (typeof LAB_STATUS_UPDATES)[number];
}