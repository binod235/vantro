import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class UpdateSettingsDto {
  // Company profile
  @IsOptional() @IsString() @MaxLength(100) name?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() website?: string;

  // Business address
  @IsOptional() @IsString() address_line1?: string;
  @IsOptional() @IsString() address_line2?: string;
  @IsOptional() @IsString() city?: string;
  @IsOptional() @IsString() county?: string;
  @IsOptional() @IsString() postcode?: string;

  // VAT & CIS
  @IsOptional() @IsBoolean() vat_registered?: boolean;
  @IsOptional() @IsString() vat_number?: string;
  @IsOptional() @IsNumber() @Min(0) @Max(100) default_vat_rate?: number;
  @IsOptional() @IsBoolean() cis_registered?: boolean;
  @IsOptional() @IsString() cis_number?: string;
  @IsOptional() @IsString() @MaxLength(20) cis_accounts_office_ref?: string;

  // Invoice defaults
  @IsOptional()
  @IsString()
  @MaxLength(10)
  @Matches(/^[A-Z0-9]+$/i, { message: 'invoice_prefix must be alphanumeric' })
  invoice_prefix?: string;

  @IsOptional() @IsInt() @Min(1) invoice_next_number?: number;
  @IsOptional() @IsString() default_payment_terms?: string;
  @IsOptional() @IsString() default_invoice_notes?: string;

  // Bank details
  @IsOptional() @IsString() bank_name?: string;
  @IsOptional() @IsString() bank_account_name?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{2}-\d{2}-\d{2}$/, { message: 'Sort code must be in format 12-34-56' })
  bank_sort_code?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{8}$/, { message: 'Account number must be 8 digits' })
  bank_account_number?: string;

  // Staff rates (pence)
  @IsOptional() @IsInt() @Min(0) standard_rate_pence?: number;
  @IsOptional() @IsInt() @Min(0) overtime_rate_pence?: number;
  @IsOptional() @IsInt() @Min(0) double_time_rate_pence?: number;

  // ─── Invoice design ───────────────────────────────────────────────────────
  @IsOptional()
  @IsString()
  @IsIn(['MODERN', 'CLASSIC', 'MINIMAL'])
  invoice_template?: string;

  @IsOptional()
  @IsString()
  @Matches(/^#[0-9A-Fa-f]{6}$/, { message: 'Accent colour must be a valid hex colour e.g. #1d4ed8' })
  invoice_accent_colour?: string;

  @IsOptional() @IsBoolean() invoice_show_logo?: boolean;
  @IsOptional() @IsBoolean() invoice_show_reference?: boolean;
  @IsOptional() @IsBoolean() invoice_show_site_address?: boolean;
  @IsOptional() @IsBoolean() invoice_show_payment_info?: boolean;

  // Reminder settings
  @IsOptional() @IsBoolean() payment_reminders_enabled?: boolean;
  @IsOptional() @IsInt() @Min(0) @Max(90) reminder_days_before?: number;
  @IsOptional() @IsInt() @Min(0) @Max(90) reminder_days_after_1?: number;
  @IsOptional() @IsInt() @Min(0) @Max(90) reminder_days_after_2?: number;
  @IsOptional() @IsInt() @Min(0) @Max(90) reminder_days_after_3?: number;
  @IsOptional() @IsBoolean() cp12_reminders_enabled?: boolean;
  @IsOptional() @IsInt() @Min(7) @Max(90) cp12_reminder_days_before?: number;

  // Appointment reminder settings
  @IsOptional() @IsBoolean() appointment_reminders_enabled?: boolean;
  @IsOptional() @IsInt() @Min(1) @Max(72) appointment_reminder_hours?: number;
  @IsOptional() @IsString() appointment_reminder_message?: string;

  // Accountant pack
  @IsOptional() @IsString() @MaxLength(254) accountant_email?: string;
  @IsOptional() @IsBoolean() accountant_pack_auto?: boolean;
}