import { IsIn, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export const LAB_PRIORITIES = ['ROUTINE', 'URGENT'] as const;

export class CreateLabOrderDto {
  @IsUUID()
  patientId: string;

  @IsString()
  @MinLength(2)
  @MaxLength(200)
  testName: string;

  @IsIn(LAB_PRIORITIES)
  priority: (typeof LAB_PRIORITIES)[number];
}