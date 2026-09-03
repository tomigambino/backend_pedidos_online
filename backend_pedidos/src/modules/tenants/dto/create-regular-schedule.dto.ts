import {
  IsNumber,
  IsString,
  IsNotEmpty,
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
}
