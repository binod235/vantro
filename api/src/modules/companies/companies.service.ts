import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'fs';
import { extname, join } from 'path';
import { PrismaService } from '../../prisma/prisma.service';
import type { CreateCompanyDto } from './dto/create-company.dto';
import type { UpdateCompanyDto } from './dto/update-company.dto';
import type { UpdateSettingsDto } from './dto/update-settings.dto';

const LOGO_DIR = join(process.cwd(), 'uploads', 'logos');
const ALLOWED_MIMETYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_SIZE = 2 * 1024 * 1024; // 2MB

@Injectable()
export class CompaniesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateCompanyDto, userId: string) {
    const existing = await this.prisma.client.user.findUnique({
      where: { id: userId },
      select: { companyId: true },
    });

    if (existing?.companyId) {
      throw new ConflictException('User already belongs to a company');
    }

    const trialEndsAt = new Date();
    trialEndsAt.setDate(trialEndsAt.getDate() + 14);

    return this.prisma.client.$transaction(async (tx) => {
      const company = await tx.company.create({
        data: { name: dto.name, trial_ends_at: trialEndsAt },
      });
      await tx.user.update({
        where: { id: userId },
        data: { companyId: company.id, role: 'OWNER' },
      });
      return company;
    });
  }

  async findForUser(userId: string) {
    const user = await this.prisma.client.user.findUnique({
      where: { id: userId },
      select: { companyId: true },
    });
    if (!user?.companyId) throw new NotFoundException('No company found for this user');
    const company = await this.prisma.client.company.findUnique({
      where: { id: user.companyId },
      omit: { stripe_customer_id: true, stripe_subscription_id: true },
    });
    if (!company) throw new NotFoundException('Company not found');
    return company;
  }

  async findPublicBySlug(slug: string) {
    const company = await this.prisma.client.company.findUnique({
      where: { slug },
      select: { name: true, slug: true },
    });
    if (!company) throw new NotFoundException('Company not found');
    return company;
  }

  async updateSlug(newSlug: string, userId: string) {
    const user = await this.prisma.client.user.findUnique({
      where: { id: userId },
      select: { companyId: true },
    });
    if (!user?.companyId) throw new NotFoundException('No company found for this user');

    const cleaned = newSlug
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');

    if (!cleaned) throw new BadRequestException('Invalid slug');

    const existing = await this.prisma.client.company.findUnique({
      where: { slug: cleaned },
      select: { id: true },
    });
    if (existing && existing.id !== user.companyId) {
      throw new ConflictException('That slug is already taken');
    }

    return this.prisma.client.company.update({
      where: { id: user.companyId },
      data: { slug: cleaned },
    });
  }

  async updateRates(
    companyId: string,
    data: {
      standard_rate_pence?: number;
      overtime_rate_pence?: number;
      double_time_rate_pence?: number;
    },
  ) {
    return this.prisma.client.company.update({ where: { id: companyId }, data });
  }

  async updateSettings(companyId: string, dto: UpdateSettingsDto) {
    return this.prisma.client.company.update({
      where: { id: companyId },
      data: {
        name: dto.name,
        phone: dto.phone,
        website: dto.website,
        address_line1: dto.address_line1,
        address_line2: dto.address_line2,
        city: dto.city,
        county: dto.county,
        postcode: dto.postcode,
        vat_registered: dto.vat_registered,
        vat_number: dto.vat_number,
        default_vat_rate: dto.default_vat_rate,
        cis_registered:          dto.cis_registered,
        cis_number:              dto.cis_number,
        cis_accounts_office_ref: dto.cis_accounts_office_ref,
        invoice_prefix: dto.invoice_prefix,
        invoice_next_number: dto.invoice_next_number,
        default_payment_terms: dto.default_payment_terms,
        default_invoice_notes: dto.default_invoice_notes,
        bank_name: dto.bank_name,
        bank_account_name: dto.bank_account_name,
        bank_sort_code: dto.bank_sort_code,
        bank_account_number: dto.bank_account_number,
        standard_rate_pence: dto.standard_rate_pence,
        overtime_rate_pence: dto.overtime_rate_pence,
        double_time_rate_pence: dto.double_time_rate_pence,
                invoice_template:          dto.invoice_template,
        invoice_accent_colour:     dto.invoice_accent_colour,
        invoice_show_logo:         dto.invoice_show_logo,
        invoice_show_reference:    dto.invoice_show_reference,
        invoice_show_site_address: dto.invoice_show_site_address,
        invoice_show_payment_info: dto.invoice_show_payment_info,
        payment_reminders_enabled: dto.payment_reminders_enabled,
        reminder_days_before:      dto.reminder_days_before,
        reminder_days_after_1:     dto.reminder_days_after_1,
        reminder_days_after_2:     dto.reminder_days_after_2,
        reminder_days_after_3:     dto.reminder_days_after_3,
        cp12_reminders_enabled:    dto.cp12_reminders_enabled,
        cp12_reminder_days_before: dto.cp12_reminder_days_before,
        appointment_reminders_enabled: dto.appointment_reminders_enabled,
        appointment_reminder_hours:    dto.appointment_reminder_hours,
        appointment_reminder_message:  dto.appointment_reminder_message,
      },
    });
  }

  async uploadLogo(
    companyId: string,
    file: { buffer: Buffer; mimetype: string; size: number; originalname: string },
  ) {
    if (!ALLOWED_MIMETYPES.includes(file.mimetype)) {
      throw new BadRequestException('Logo must be PNG, JPG, or WebP');
    }
    if (file.size > MAX_SIZE) {
      throw new BadRequestException('Logo must be under 2MB');
    }

    // Ensure upload directory exists
    if (!existsSync(LOGO_DIR)) mkdirSync(LOGO_DIR, { recursive: true });

    // Delete existing logo file(s) for this company
    const company = await this.prisma.client.company.findUnique({
      where: { id: companyId },
      select: { logo_url: true },
    });
    if (company?.logo_url) {
      const oldPath = join(process.cwd(), company.logo_url.replace(/^\//, ''));
      if (existsSync(oldPath)) unlinkSync(oldPath);
    }

    const ext = extname(file.originalname).toLowerCase() || `.${file.mimetype.split('/')[1]}`;
    const filename = `${companyId}${ext}`;
    const filepath = join(LOGO_DIR, filename);
    writeFileSync(filepath, file.buffer);

    const logo_url = `/uploads/logos/${filename}`;
    return this.prisma.client.company.update({
      where: { id: companyId },
      data: { logo_url },
    });
  }

  async deleteLogo(companyId: string) {
    const company = await this.prisma.client.company.findUnique({
      where: { id: companyId },
      select: { logo_url: true },
    });
    if (company?.logo_url) {
      const path = join(process.cwd(), company.logo_url.replace(/^\//, ''));
      if (existsSync(path)) unlinkSync(path);
    }
    return this.prisma.client.company.update({
      where: { id: companyId },
      data: { logo_url: null },
    });
  }

  async update(dto: UpdateCompanyDto, userId: string) {
    const user = await this.prisma.client.user.findUnique({
      where: { id: userId },
      select: { companyId: true },
    });
    if (!user?.companyId) throw new NotFoundException('No company found for this user');
    return this.prisma.client.company.update({
      where: { id: user.companyId },
      data: { name: dto.name },
    });
  }

  // ── Onboarding checklist status ─────────────────────────────────────────────

  async getOnboardingStatus(companyId: string) {
    const [company, customerCount, quoteCount, chasePolicy] = await Promise.all([
      this.prisma.client.company.findUnique({
        where: { id: companyId },
        select: {
          logo_url: true, name: true, phone: true,
          onboarding_dismissed: true, first_import_done: true,
        },
      }),
      this.prisma.client.customer.count({ where: { company_id: companyId } }),
      this.prisma.client.quote.count({ where: { company_id: companyId } }),
      this.prisma.client.chasePolicy.findUnique({
        where: { company_id: companyId },
        select: { enabled: true },
      }),
    ]);

    if (!company) throw new NotFoundException('Company not found');

    const steps = [
      {
        id: 'company_details',
        label: 'Add company details & logo',
        done: !!(company.logo_url && company.name && company.phone),
        href: '/dashboard/settings?tab=profile',
        cta: 'Go to Settings',
      },
      {
        id: 'first_customer',
        label: 'Add your first customer',
        done: customerCount >= 1,
        href: '/dashboard/customers',
        cta: 'Add a customer',
      },
      {
        id: 'import_customers',
        label: 'Import customers from a CSV',
        done: company.first_import_done || customerCount >= 5,
        href: '/dashboard/settings?tab=import',
        cta: 'Import CSV',
      },
      {
        id: 'first_quote',
        label: 'Send your first quote',
        done: quoteCount >= 1,
        href: '/dashboard/quotes',
        cta: 'Create a quote',
      },
      {
        id: 'auto_chase',
        label: 'Turn on Auto-Chase',
        done: chasePolicy?.enabled === true,
        href: '/dashboard/settings?tab=chase',
        cta: 'Set up Auto-Chase',
      },
    ];

    const completedCount = steps.filter(s => s.done).length;

    return {
      dismissed: company.onboarding_dismissed,
      completedCount,
      totalCount: steps.length,
      allDone: completedCount === steps.length,
      steps,
    };
  }
}
