import { IsIn, IsObject, IsOptional, IsString } from 'class-validator';

export class CreateGasCertDto {
  @IsString()
  @IsIn(['CP12', 'BOILER_SERVICE', 'GAS_WARNING', 'INSTALLATION'])
  cert_type: string;

  @IsString()
  customer_id: string;

  @IsString()
  @IsOptional()
  job_id?: string;

  @IsString()
  @IsOptional()
  engineer_id?: string;

  @IsString()
  inspection_date: string;

  @IsString()
  @IsOptional()
  property_address?: string;

  @IsString()
  @IsOptional()
  property_city?: string;

  @IsString()
  @IsOptional()
  property_postcode?: string;

  @IsString()
  @IsOptional()
  engineer_name?: string;

  @IsString()
  @IsOptional()
  gas_safe_number?: string;

  @IsObject()
  data: Record<string, unknown>;

  @IsString()
  @IsOptional()
  notes?: string;

  @IsString()
  @IsOptional()
  next_due_date?: string;
}
