import { IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class CreateCareRecordDto {
  @IsOptional()
  @IsInt()
  @Min(50)
  @Max(300)
  systolic?: number;

  @IsOptional()
  @IsInt()
  @Min(30)
  @Max(200)
  diastolic?: number;

  @IsOptional()
  @IsInt()
  @Min(20)
  @Max(300)
  pulse?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(30)
  @Max(45)
  temperatureC?: number;

  @IsOptional()
  @IsInt()
  @Min(50)
  @Max(100)
  oxygenSat?: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}