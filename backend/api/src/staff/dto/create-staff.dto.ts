import {
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

// Roles an admin may assign. SUPER_ADMIN and HOSPITAL_ADMIN are deliberately excluded.
export const STAFF_ROLES = [
  'DOCTOR',
  'NURSE',
  'LAB_TECH',
  'PHARMACIST',
  'RECEPTIONIST',
] as const;

export class CreateStaffDto {
  @IsString()
  @MinLength(2)
  @MaxLength(50)
  firstName: string;

  @IsString()
  @MinLength(2)
  @MaxLength(50)
  lastName: string;

  @IsEmail()
  email: string;

  @IsString()
  @MinLength(10)
  @MaxLength(72)
  password: string;

  @IsIn(STAFF_ROLES)
  role: (typeof STAFF_ROLES)[number];

  @IsOptional()
  @IsUUID()
  departmentId?: string;
}