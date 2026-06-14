import { IsIn, IsNotEmpty, IsString } from 'class-validator';

const CIS_STATUSES = ['GROSS', 'STANDARD', 'HIGHER'] as const;

export class VerifySubcontractorDto {
  @IsIn(CIS_STATUSES)
  cis_status: 'GROSS' | 'STANDARD' | 'HIGHER';

  @IsString()
  @IsNotEmpty()
  verification_number: string;
}
