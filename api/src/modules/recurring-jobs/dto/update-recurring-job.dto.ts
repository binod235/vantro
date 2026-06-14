import { IsOptional, IsString, IsInt, IsIn, IsBoolean, Min } from 'class-validator';

export class UpdateRecurringJobDto {
  @IsString()  @IsOptional() title?: string;
  @IsString()  @IsOptional() customer_id?: string;
  @IsString()  @IsOptional() engineer_id?: string | null;
  @IsString()  @IsOptional() description?: string;
  @IsString()  @IsOptional() schedule_note?: string;
  @IsInt()     @IsOptional() duration_minutes?: number;
  @IsString()  @IsIn(['DAYS', 'WEEKS', 'MONTHS']) @IsOptional() frequency_type?: string;
  @IsInt()     @Min(1) @IsOptional() frequency_value?: number;
  @IsString()  @IsIn(['CALENDAR', 'ON_COMPLETION']) @IsOptional() trigger_type?: string;
  @IsString()  @IsIn(['SAME_ENGINEER', 'MANUAL']) @IsOptional() assign_type?: string;
  @IsString()  @IsIn(['SCHEDULE', 'ASSIGN', 'CREATE_ONLY']) @IsOptional() creation_mode?: string;
  @IsString()  @IsOptional() scheduled_time?: string;
  @IsBoolean() @IsOptional() is_active?: boolean;
  @IsString()  @IsOptional() next_run_date?: string;
}
