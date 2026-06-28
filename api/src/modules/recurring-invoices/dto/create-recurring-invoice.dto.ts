import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

const FREQUENCIES = ['WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY'] as const;

export class RecurringInvoiceLineItemDto {
  @IsString() description: string;
  @IsNumber() @IsPositive() quantity: number;
  @IsInt() @Min(0) unit_price_pence: number;
  @IsInt() @Min(0) @Max(100) vat_rate: number;
}

export class CreateRecurringInvoiceDto {
  @IsString() customer_id: string;
  @IsString() title: string;
  @IsArray() @ValidateNested({ each: true }) @Type(() => RecurringInvoiceLineItemDto) line_items: RecurringInvoiceLineItemDto[];

  @IsIn(FREQUENCIES) frequency: string;
  @IsDateString() start_date: string;
  @IsOptional() @IsInt() @Min(1) @Max(31) day_of_month?: number;

  @IsOptional() @IsInt() @Min(0) payment_terms_days?: number;
  @IsOptional() @IsBoolean() auto_email?: boolean;
  @IsOptional() @IsString() notes?: string;
}
