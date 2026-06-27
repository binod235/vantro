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

  // No cis_status field here, deliberately — HMRC's own process is that an
  // unverified subcontractor is always Higher rate (30%). CIS status can
  // only change via the Verify action (see VerifySubcontractorDto), never
  // at creation.

  @IsOptional()
  @IsString()
  notes?: string;
}
