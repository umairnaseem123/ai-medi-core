import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] as const;

export class UpsertMedicalRecordDto {
  @IsOptional()
  @IsIn(BLOOD_GROUPS)
  bloodGroup?: (typeof BLOOD_GROUPS)[number];

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  allergies?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  chronicConditions?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  familyHistory?: string;
}