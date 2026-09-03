import {
  IsString,
  IsNotEmpty,
  IsBoolean,
  IsOptional,
  ValidateIf,
  Matches,
} from 'class-validator';

export class CreateExceptionDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  date: string;

  @IsBoolean()
  isOpen: boolean;

  @ValidateIf((o) => o.isOpen === true)
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{2}:\d{2}$/)
  openingTime?: string;

  @ValidateIf((o) => o.isOpen === true)
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{2}:\d{2}$/)
  closingTime?: string;

  @IsString()
  @IsOptional()
  reason?: string;
}
