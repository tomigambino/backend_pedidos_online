import { IsEmail, IsNotEmpty, IsString, Matches } from 'class-validator';

export class RegisterDto {
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @IsString()
  @IsNotEmpty()
  password: string;

  @IsString()
  @IsNotEmpty()
  tenantName: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/^[a-z0-9-]+$/)
  tenantSlug: string;
}
