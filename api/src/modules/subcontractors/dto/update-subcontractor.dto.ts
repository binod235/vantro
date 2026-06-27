import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

const SUBCONTRACTOR_TYPES = ['SOLE_TRADER', 'PARTNERSHIP', 'COMPANY'] as const;

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

  // cis_status, verification_number and verification_date are deliberately
  // absent here — they can only change together via the Verify action
  // (VerifySubcontractorDto / recordVerification), matching HMRC's real
  // process and avoiding a back door that bypasses verification.

  @IsOptional()
  @IsString()
  notes?: string | null;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}
