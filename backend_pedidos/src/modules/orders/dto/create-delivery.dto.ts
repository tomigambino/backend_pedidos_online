import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateDeliveryDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  address: string;

  @IsString()
  @IsOptional()
  @MaxLength(300)
  notes?: string;
}