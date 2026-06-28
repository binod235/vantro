import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { RecurringInvoiceLineItemDto } from './create-recurring-invoice.dto';

const FREQUENCIES = ['WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY'] as const;

export class UpdateRecurringInvoiceDto {
  @IsOptional() @IsString() customer_id?: string;
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => RecurringInvoiceLineItemDto) line_items?: RecurringInvoiceLineItemDto[];

  @IsOptional() @IsIn(FREQUENCIES) frequency?: string;
  @IsOptional() @IsDateString() next_run_date?: string;
  @IsOptional() @IsInt() @Min(1) @Max(31) day_of_month?: number;

  @IsOptional() @IsInt() @Min(0) payment_terms_days?: number;
  @IsOptional() @IsBoolean() auto_email?: boolean;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsBoolean() is_active?: boolean;
}
