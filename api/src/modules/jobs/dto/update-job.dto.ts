import { JobStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsDate,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Min,
  ValidateIf,
} from 'class-validator';

export class UpdateJobDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  customer_id?: string;

  /** Pass null to unassign the engineer from this job. */
  @IsOptional()
  @ValidateIf((_, val) => val !== null)
  @IsString()
  engineer_id?: string | null;

  @IsOptional()
  @IsEnum(JobStatus)
  status?: JobStatus;

  /** Pass null to clear the scheduled date. */
  @IsOptional()
  @ValidateIf((_, val) => val !== null)
  @Type(() => Date)
  @IsDate()
  scheduled_at?: Date | null;

  /** Duration in minutes. Pass null to clear. Minimum 15 minutes. */
  @IsOptional()
  @ValidateIf((_, val) => val !== null)
  @IsInt()
  @Min(15)
  duration_minutes?: number | null;

  /** Internal note for the engineer on this visit. Pass null to clear. */
  @IsOptional()
  @ValidateIf((_, val) => val !== null)
  @IsString()
  schedule_note?: string | null;

  /** Free-text notes saved against the job. Pass null to clear. */
  @IsOptional()
  @ValidateIf((_, val) => val !== null)
  @IsString()
  notes?: string | null;
}
