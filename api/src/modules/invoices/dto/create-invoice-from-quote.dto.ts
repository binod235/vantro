import {
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class CreateInvoiceFromQuoteDto {
  @IsEnum(['ENTIRE_QUOTE', 'SELECTED_LINE_ITEMS', 'PERCENTAGE', 'FIXED_AMOUNT'])
  mode: string;

  /** Used for SELECTED_LINE_ITEMS mode */
  @IsOptional() @IsArray() selected_line_item_ids?: string[];

  /** Used for PERCENTAGE mode — integer percent 1..100 */
  @IsOptional() @IsInt() @Min(1) @Max(100) percentage?: number;

  /** Used for FIXED_AMOUNT mode — pence */
  @IsOptional() @IsInt() @Min(1) fixed_amount_pence?: number;

  @IsOptional() @IsEnum(['STANDARD', 'DEPOSIT', 'PROGRESS', 'FINAL']) invoice_type?: string;
  @IsOptional() @IsDateString() due_date?: string;
  @IsOptional() @IsString() notes?: string;
}
