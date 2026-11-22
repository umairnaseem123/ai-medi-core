import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class ReceiveStockDto {
  @IsInt()
  @Min(1)
  @Max(1000000)
  quantity: number;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;
}