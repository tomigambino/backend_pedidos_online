import { PartialType } from '@nestjs/mapped-types';
import { CreateRegularScheduleDto } from './create-regular-schedule.dto';

export class UpdateRegularScheduleDto extends PartialType(CreateRegularScheduleDto) {}
