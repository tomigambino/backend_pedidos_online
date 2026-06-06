import { IsString, IsNotEmpty } from 'class-validator';

export class UpdateCustomerPhoneDto {
  @IsString()
  @IsNotEmpty()
  phone: string;
}
