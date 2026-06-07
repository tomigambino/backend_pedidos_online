import { IsEmail, IsNotEmpty, IsString, Matches, MinLength } from 'class-validator';

export class RegisterDto {
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  password: string;

  @IsString()
  @IsNotEmpty()
  tenantName: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/^[a-z0-9-]+$/)
  tenantSlug: string;
}
