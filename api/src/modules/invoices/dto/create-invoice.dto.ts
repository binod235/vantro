import {
  IsArray,
  IsDateString,
  IsEnum,
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

export class LineItemDto {
  @IsString() description: string;
  @IsNumber() @IsPositive() quantity: number;
  @IsInt() @Min(0) unit_price_pence: number;
  @IsEnum(['STANDARD', 'REVERSE_CHARGE', 'EXEMPT', 'ZERO_RATED']) vat_type: string;
  @IsInt() @Min(0) @Max(100) vat_rate: number;
  @IsOptional() @IsString() source_quote_line_item_id?: string;
}

export class CreateInvoiceDto {
  @IsString() customer_id: string;
  @IsOptional() @IsString() job_id?: string;
  @IsOptional() @IsEnum(['STANDARD', 'DEPOSIT', 'PROGRESS', 'FINAL']) invoice_type?: string;
  @IsArray() @ValidateNested({ each: true }) @Type(() => LineItemDto) line_items: LineItemDto[];
  @IsOptional() @IsDateString() due_date?: string;
  @IsOptional() @IsDateString() issue_date?: string;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsString() payment_method?: string;
}
