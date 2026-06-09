import { IsEnum, IsNotEmpty } from 'class-validator';
import { EnquiryStatus } from '@prisma/client';

export class UpdateEnquiryStatusDto {
  @IsEnum(EnquiryStatus)
  @IsNotEmpty()
  status: EnquiryStatus;
}
