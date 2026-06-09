import { PartialType } from '@nestjs/mapped-types';
import { IsEnum, IsOptional } from 'class-validator';
import { EnquiryStatus } from '@prisma/client';
import { CreateEnquiryDto } from './create-enquiry.dto';

export class UpdateEnquiryDto extends PartialType(CreateEnquiryDto) {
  @IsOptional()
  @IsEnum(EnquiryStatus)
  status?: EnquiryStatus;
}
