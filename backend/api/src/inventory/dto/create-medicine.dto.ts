import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateMedicineDto {
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  name: string;

  @IsString()
  @MinLength(1)
  @MaxLength(50)
  unit: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000000)
  reorderAt?: number;
}