import {
  IsDateString,
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { EnquirySource } from '@prisma/client';

export class CreateEnquiryDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  address_line1?: string;

  @IsOptional()
  @IsString()
  address_line2?: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  county?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2}$/i, {
    message: 'postcode must be a valid UK postcode',
  })
  postcode?: string;

  @IsOptional()
  @IsDateString()
  received_date?: string;

  @IsOptional()
  @IsEnum(EnquirySource)
  source?: EnquirySource;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  customer_id?: string;

  @IsOptional()
  @IsString()
  assigned_to_id?: string;
}
