import { IsDateString, IsOptional, IsString } from 'class-validator';

export class MarkPaidDto {
  @IsOptional() @IsDateString() paid_date?: string;
  @IsOptional() @IsString() payment_method?: string;
  @IsOptional() @IsString() reference?: string;
}
