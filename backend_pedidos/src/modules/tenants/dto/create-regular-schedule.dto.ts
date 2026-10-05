import {
  IsNumber,
  IsString,
  IsNotEmpty,
  IsOptional,
  Min,
  Max,
  Matches,
} from 'class-validator';

export class CreateRegularScheduleDto {
  @IsNumber()
  @Min(1)
  @Max(7)
  dayOfWeek: number;

  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{2}:\d{2}$/)
  openingTime: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{2}:\d{2}$/)
  closingTime: string;

  @IsString()
  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, {
    message: 'maxOrderTime debe estar en formato HH:mm o HH:mm:ss',
  })
  maxOrderTime?: string;
}
