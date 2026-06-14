import {
  IsString, IsOptional, IsInt, IsIn, Min,
} from 'class-validator';

export class CreateRecurringJobDto {
  @IsString() title: string;
  @IsString() customer_id: string;
  @IsString() @IsOptional() engineer_id?: string;
  @IsString() @IsOptional() description?: string;
  @IsString() @IsOptional() schedule_note?: string;
  @IsInt()    @IsOptional() duration_minutes?: number;

  @IsString() @IsIn(['DAYS', 'WEEKS', 'MONTHS']) frequency_type: string;
  @IsInt()    @Min(1) frequency_value: number;

  @IsString() @IsIn(['CALENDAR', 'ON_COMPLETION']) trigger_type: string;
  @IsString() @IsOptional() start_date?: string;

  @IsString() @IsIn(['SAME_ENGINEER', 'MANUAL']) @IsOptional()
  assign_type?: string;

  @IsString() @IsIn(['SCHEDULE', 'ASSIGN', 'CREATE_ONLY']) @IsOptional()
  creation_mode?: string;

  @IsString() @IsOptional()
  scheduled_time?: string;
}
