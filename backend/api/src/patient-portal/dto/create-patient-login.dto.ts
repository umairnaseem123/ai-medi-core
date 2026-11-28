import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class CreatePatientLoginDto {
  @IsEmail()
  @MaxLength(200)
  email: string;

  @IsString()
  @MinLength(12)
  @MaxLength(72)
  password: string;
}