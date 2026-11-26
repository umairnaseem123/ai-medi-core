import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class UpsertDoctorProfileDto {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  specialization: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  licenseNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  bio?: string;
}