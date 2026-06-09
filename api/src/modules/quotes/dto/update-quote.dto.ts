import {
  IsArray,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { QuoteLineItemDto } from './create-quote.dto';

export class UpdateQuoteDto {
  @IsString()
  @IsOptional()
  customer_id?: string;

  @IsOptional()
  job_id?: string | null;

  @IsString()
  @IsOptional()
  reference?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QuoteLineItemDto)
  @IsOptional()
  line_items?: QuoteLineItemDto[];

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
