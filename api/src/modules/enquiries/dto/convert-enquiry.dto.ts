import { IsDateString, IsOptional, IsString } from 'class-validator';

export class ConvertEnquiryDto {
  @IsOptional()
  @IsDateString()
  scheduled_at?: string;

  @IsOptional()
  @IsString()
  engineer_id?: string;
}
