import {
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { LineItemDto } from './create-invoice.dto';

export class UpdateInvoiceDto {
  @IsOptional() @IsString() customer_id?: string;
  @IsOptional() @IsString() job_id?: string;
  @IsOptional() @IsEnum(['STANDARD', 'DEPOSIT', 'PROGRESS', 'FINAL']) invoice_type?: string;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => LineItemDto) line_items?: LineItemDto[];
  @IsOptional() @IsDateString() due_date?: string;
  @IsOptional() @IsDateString() issue_date?: string;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsString() payment_method?: string;
  @IsOptional() @IsInt() @Min(0) amount_paid_pence?: number;
}
