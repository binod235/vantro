import {
  IsBoolean,
  IsDateString,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

const SUBCONTRACTOR_TYPES = ['SOLE_TRADER', 'PARTNERSHIP', 'COMPANY'] as const;
const CIS_STATUSES        = ['GROSS', 'STANDARD', 'HIGHER'] as const;

export class UpdateSubcontractorDto {
  @IsOptional()
  @IsString()
  @MaxLength(150)
  name?: string;

  @IsOptional()
  @IsEmail()
  email?: string | null;

  @IsOptional()
  @IsString()
  phone?: string | null;

  @IsOptional()
  @IsString()
  address?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  utr_number?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(9)
  ni_number?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(8)
  company_reg_number?: string | null;

  @IsOptional()
  @IsIn(SUBCONTRACTOR_TYPES)
  subcontractor_type?: string;

  @IsOptional()
  @IsIn(CIS_STATUSES)
  cis_status?: string;

  @IsOptional()
  @IsString()
  verification_number?: string | null;

  @IsOptional()
  @IsDateString()
  verification_date?: string | null;

  @IsOptional()
  @IsString()
  notes?: string | null;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}
