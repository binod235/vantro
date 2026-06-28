import {
  IsArray,
  IsDateString,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CreditNoteLineItemDto } from './create-credit-note.dto';

export class UpdateCreditNoteDto {
  @IsOptional() @IsString() customer_id?: string;
  @IsOptional() @IsString() invoice_id?: string;
  @IsOptional() @IsString() reason?: string;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => CreditNoteLineItemDto) line_items?: CreditNoteLineItemDto[];
  @IsOptional() @IsDateString() date?: string;
  @IsOptional() @IsString() notes?: string;
}
