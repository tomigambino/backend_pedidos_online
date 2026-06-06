import { RegularScheduleResponseDto } from './regular-schedule-response.dto';
import { ExceptionResponseDto } from './exception-response.dto';

export class TenantConfigResponseDto {
  name: string;
  logo: string | null;
  banner: string | null;
  primaryColor: string | null;
  secondaryColor: string | null;
  description: string | null;
  whatsapp: string | null;
  address: string | null;
  isOpen: boolean;
  deliveryCostEnabled: boolean;
  deliveryCost: number | null;
  schedule: {
    regular: RegularScheduleResponseDto[];
    exceptions: ExceptionResponseDto[];
  };
}
