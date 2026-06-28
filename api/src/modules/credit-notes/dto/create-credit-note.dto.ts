import {
  IsArray,
  IsDateString,
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

export class CreditNoteLineItemDto {
  @IsString() description: string;
  @IsNumber() @IsPositive() quantity: number;
  @IsInt() @Min(0) unit_price_pence: number;
  @IsInt() @Min(0) @Max(100) vat_rate: number;
}

export class CreateCreditNoteDto {
  @IsString() customer_id: string;
  @IsOptional() @IsString() invoice_id?: string;
  @IsString() reason: string;
  @IsArray() @ValidateNested({ each: true }) @Type(() => CreditNoteLineItemDto) line_items: CreditNoteLineItemDto[];
  @IsOptional() @IsDateString() date?: string;
  @IsOptional() @IsString() notes?: string;
}
