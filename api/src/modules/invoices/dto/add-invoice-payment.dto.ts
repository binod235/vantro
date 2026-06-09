import { IsDateString, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class AddInvoicePaymentDto {
  @IsInt() @Min(1) amount_pence: number;
  @IsDateString() payment_date: string;
  @IsOptional() @IsString() payment_method?: string;
  @IsOptional() @IsString() reference?: string;
  @IsOptional() @IsString() notes?: string;
}
