import { IsEnum } from 'class-validator';

export class UpdateInvoiceStatusDto {
  @IsEnum(['DRAFT', 'SENT', 'PART_PAID', 'PAID', 'OVERDUE', 'CANCELLED'])
  status: string;
}
