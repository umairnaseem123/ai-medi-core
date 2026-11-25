import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class PrescriptionItemDto {
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  medicine: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  dose: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  frequency: string;

  @IsInt()
  @Min(1)
  @Max(365)
  durationDays: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10000)
  quantity?: number;
}

export class CreatePrescriptionDto {
  @IsUUID()
  patientId: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => PrescriptionItemDto)
  items: PrescriptionItemDto[];
}