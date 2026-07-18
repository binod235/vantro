import { IsBoolean, IsIn, IsISO8601, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateApplianceDto {
  @IsString()
  customer_id: string;

  @IsOptional()
  @IsString()
  @IsIn(['BOILER', 'CYLINDER', 'FIRE', 'COOKER', 'OTHER'])
  type?: string;

  @IsOptional() @IsString() @MaxLength(100) make?: string;
  @IsOptional() @IsString() @MaxLength(100) model?: string;
  @IsOptional() @IsString() @MaxLength(50)  gc_number?: string;
  @IsOptional() @IsString() @MaxLength(100) serial_number?: string;
  @IsOptional() @IsString() @MaxLength(100) location?: string;
  @IsOptional() @IsISO8601() installed_date?: string;
  @IsOptional() @IsString() install_job_id?: string;
  @IsOptional() @IsISO8601() next_service_due?: string;
  @IsOptional() @IsISO8601() warranty_expiry?: string;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;
  @IsOptional() @IsBoolean() archived?: boolean;

  // Optionally link to a gas cert at creation time
  @IsOptional() @IsString() cert_id?: string;
}
