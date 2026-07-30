import {
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
  ValidateNested,
  ArrayMinSize,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PaymentMethod } from '../../../common/enums/payment-method.enum';
import { DeliveryType } from '../../../common/enums/delivery-type.enum';
import { CreateOrderItemDto } from './create-order-item.dto';
import { CreateCustomerDto } from './create-customer.dto';

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

  @IsEnum(DeliveryType)
  deliveryType: DeliveryType;

  @ValidateIf(o => o.deliveryType === DeliveryType.ENVIO_DOMICILIO)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  address?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  notes?: string;

  @ValidateIf(o => o.deliveryType === DeliveryType.ENVIO_DOMICILIO)
  @IsOptional()
  @IsString()
  @MaxLength(300)
  deliveryNotes?: string;
}
