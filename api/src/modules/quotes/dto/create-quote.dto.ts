import {
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class QuoteLineItemDto {
  @IsString()
  description: string;

  @IsNumber()
  @Min(0)
  quantity: number;

  @IsInt()
  @Min(0)
  unit_price_pence: number;

  @IsString()
  @IsIn(['STANDARD', 'REVERSE_CHARGE', 'EXEMPT', 'ZERO_RATED'])
  vat_type: string;

  @IsNumber()
  @Min(0)
  vat_rate: number;
}

export class CreateQuoteDto {
  @IsString()
  customer_id: string;

  @IsString()
  @IsOptional()
  job_id?: string;

  @IsString()
  @IsOptional()
  reference?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QuoteLineItemDto)
  line_items: QuoteLineItemDto[];

  @IsString()
  @IsOptional()
  issue_date?: string;

  @IsString()
  @IsOptional()
  expiry_date?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}
