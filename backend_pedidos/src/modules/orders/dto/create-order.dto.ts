import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  ValidateNested,
  ArrayMinSize,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PaymentMethod } from '../../../common/enums/payment-method.enum';
import { CreateOrderItemDto } from './create-order-item.dto';
import { CreateCustomerDto } from './create-customer.dto';
import { CreateDeliveryDto } from './create-delivery.dto';

export class CreateOrderDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateOrderItemDto)
  items: CreateOrderItemDto[];

  @ValidateNested()
  @Type(() => CreateCustomerDto)
  customer: CreateCustomerDto;

  @IsEnum(PaymentMethod)
  paymentMethod: PaymentMethod;

  @IsBoolean()
  storePickup: boolean;

  @ValidateNested()
  @Type(() => CreateDeliveryDto)
  @IsOptional()
  delivery?: CreateDeliveryDto;
}
