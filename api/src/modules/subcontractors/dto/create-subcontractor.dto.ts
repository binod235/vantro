import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

const SUBCONTRACTOR_TYPES = ['SOLE_TRADER', 'PARTNERSHIP', 'COMPANY'] as const;
const CIS_STATUSES        = ['GROSS', 'STANDARD', 'HIGHER'] as const;

export class CreateSubcontractorDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  name: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  utr_number?: string;

  @IsOptional()
  @IsString()
  @MaxLength(9)
  ni_number?: string;

  @IsOptional()
  @IsString()
  @MaxLength(8)
  company_reg_number?: string;

  @IsOptional()
  @IsIn(SUBCONTRACTOR_TYPES)
  subcontractor_type?: string;

  @IsOptional()
  @IsIn(CIS_STATUSES)
  cis_status?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
