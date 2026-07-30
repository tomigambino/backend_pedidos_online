import { IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class CreateCustomerDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  @Matches(/^[0-9+\-\s()]{6,20}$/, {
    message: 'El teléfono debe contener solo números, espacios, +, - o paréntesis (6 a 20 caracteres)',
  })
  phone: string;

  @IsString()
  @IsOptional()
  @MaxLength(200)
  address?: string;
}
