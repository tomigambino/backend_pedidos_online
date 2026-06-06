export class ExceptionResponseDto {
  id: string;
  date: string;
  isOpen: boolean;
  openingTime: string | null;
  closingTime: string | null;
  reason: string | null;
}
