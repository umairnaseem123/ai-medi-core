import { IsString, MaxLength, MinLength } from 'class-validator';

export class EnterResultDto {
  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  result: string;
}