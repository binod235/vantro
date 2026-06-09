import { BillingRate } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDate,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class CreateTimesheetDto {
  @IsOptional()
  @IsString()
  user_id?: string;

  @IsOptional()
  @IsString()
  job_id?: string;

  @Type(() => Date)
  @IsDate()
  date: Date;

  @Type(() => Date)
  @IsDate()
  start_time: Date;

  @Type(() => Date)
  @IsDate()
  finish_time: Date;

  @IsOptional()
  @IsInt()
  @Min(0)
  break_minutes?: number;

  @IsOptional()
  @IsEnum(BillingRate)
  billing_rate?: BillingRate;

  @IsOptional()
  @IsInt()
  @Min(0)
  hourly_rate_pence?: number;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsBoolean()
  is_timer_entry?: boolean;

  @IsOptional()
  @IsString()
  clock_in_address?: string;

  @IsOptional()
  @IsString()
  clock_out_address?: string;

  @IsOptional()
  @IsNumber()
  clock_in_lat?: number;

  @IsOptional()
  @IsNumber()
  clock_in_lng?: number;

  @IsOptional()
  @IsNumber()
  clock_out_lat?: number;

  @IsOptional()
  @IsNumber()
  clock_out_lng?: number;
}
