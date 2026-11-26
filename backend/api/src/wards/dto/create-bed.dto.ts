import { IsString, MaxLength, MinLength } from 'class-validator';

export class CreateBedDto {
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  label: string;
}