import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { CreateApplianceDto } from './dto/create-appliance.dto';
import type { UpdateApplianceDto } from './dto/update-appliance.dto';
import * as QRCode from 'qrcode';

const FRONTEND_URL = process.env.FRONTEND_URL ?? 'https://vantro.co.uk';

// Safe fields returned to the public passport
const PUBLIC_CERT_TYPES: Record<string, string> = {
  CP12: 'Gas Safety Certificate',
  BOILER_SERVICE: 'Annual Boiler Service',
  GAS_WARNING: 'Gas Safety Warning',
  INSTALLATION: 'Appliance Installation',
};

@Injectable()
export class AppliancesService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── CRUD ──────────────────────────────────────────────────────────────────

  async findAllForCustomer(customerId: string, companyId: string) {
    return this.prisma.client.appliance.findMany({
      where: { customer_id: customerId, company_id: companyId, archived: false },
      include: { customer: { select: { id: true, name: true } } },
      orderBy: { next_service_due: 'asc' },
    });
  }

  async findOne(id: string, companyId: string) {
    const a = await this.prisma.client.appliance.findFirst({
      where: { id, company_id: companyId },
      include: {
        customer: { select: { id: true, name: true, email: true, phone: true, address_line1: true, postcode: true } },
        gasCertificates: {
          where: { status: 'COMPLETE' },
          orderBy: { inspection_date: 'desc' },
          select: { id: true, cert_type: true, cert_number: true, inspection_date: true, next_due_date: true, data: true, notes: true },
          take: 10,
        },
      },
    });
    if (!a) throw new NotFoundException('Appliance not found');
    return a;
  }

  async create(dto: CreateApplianceDto, companyId: string) {
    await this.verifyCustomer(dto.customer_id, companyId);

    const appliance = await this.prisma.client.appliance.create({
      data: {
        company_id: companyId,
        customer_id: dto.customer_id,
        type: dto.type ?? 'BOILER',
        make: dto.make,
        model: dto.model,
        gc_number: dto.gc_number,
        serial_number: dto.serial_number,
        location: dto.location,
        installed_date: dto.installed_date ? new Date(dto.installed_date) : undefined,
        install_job_id: dto.install_job_id,
        next_service_due: dto.next_service_due ? new Date(dto.next_service_due) : undefined,
        warranty_expiry: dto.warranty_expiry ? new Date(dto.warranty_expiry) : undefined,
        notes: dto.notes,
      },
    });

    // If a cert_id was given, link it
    if (dto.cert_id) {
      await this.prisma.client.gasSafetyCertificate.updateMany({
        where: { id: dto.cert_id, company_id: companyId },
        data: { appliance_id: appliance.id },
      });
    }

    return appliance;
  }

  async update(id: string, dto: UpdateApplianceDto, companyId: string) {
    await this.verifyAppliance(id, companyId);
    return this.prisma.client.appliance.update({
      where: { id },
      data: {
        type: dto.type,
        make: dto.make,
        model: dto.model,
        gc_number: dto.gc_number,
        serial_number: dto.serial_number,
        location: dto.location,
        installed_date: dto.installed_date ? new Date(dto.installed_date) : undefined,
        install_job_id: dto.install_job_id,
        last_service_date: dto.last_service_date ? new Date(dto.last_service_date) : undefined,
        next_service_due: dto.next_service_due ? new Date(dto.next_service_due) : undefined,
        warranty_expiry: dto.warranty_expiry ? new Date(dto.warranty_expiry) : undefined,
        notes: dto.notes,
        archived: dto.archived,
      },
    });
  }

  async remove(id: string, companyId: string) {
    await this.verifyAppliance(id, companyId);
    // Soft-delete — preserve history
    await this.prisma.client.appliance.update({ where: { id }, data: { archived: true } });
  }

  // ─── Auto-update after a service job ──────────────────────────────────────

  /** Called when a job is marked COMPLETED. If it has an appliance_id, update service dates. */
  async updateServiceDates(applianceId: string, serviceDate: Date) {
    const nextDue = new Date(serviceDate);
    nextDue.setFullYear(nextDue.getFullYear() + 1);
    await this.prisma.client.appliance.update({
      where: { id: applianceId },
      data: { last_service_date: serviceDate, next_service_due: nextDue },
    });
  }

  // ─── Print QR data ─────────────────────────────────────────────────────────

  async getQrData(id: string, companyId: string): Promise<{ url: string; label: string }> {
    const a = await this.verifyAppliance(id, companyId);
    const company = await this.prisma.client.company.findUnique({
      where: { id: companyId },
      select: { name: true },
    });
    const url = `${FRONTEND_URL}/boiler/${a.public_token}`;
    const label = [a.make, a.model].filter(Boolean).join(' ') || a.type;
    return { url, label: `Scan for service history · ${company?.name ?? ''}`, appliance: label } as unknown as { url: string; label: string };
  }

  // ─── Sticker data (QR + branding for print page) ─────────────────────────

  async getStickerData(id: string, companyId: string) {
    const a = await this.verifyAppliance(id, companyId);
    const company = await this.prisma.client.company.findUnique({
      where: { id: companyId },
      select: { name: true, phone: true, logo_url: true },
    });
    const url = `${FRONTEND_URL}/boiler/${a.public_token}`;
    const applianceLabel = [a.make, a.model].filter(Boolean).join(' ') || a.type;

    let qrDataUri: string | null = null;
    try {
      qrDataUri = await QRCode.toDataURL(url, {
        errorCorrectionLevel: 'H',
        width: 400,
        margin: 2,
        color: { dark: '#1e3a5f', light: '#ffffff' },
      });
    } catch { /* non-fatal */ }

    return {
      url,
      qrDataUri,
      applianceLabel,
      applianceType: a.type,
      location: a.location,
      company: {
        name: company?.name ?? '',
        phone: company?.phone ?? null,
        logo_url: company?.logo_url ?? null,
      },
    };
  }

  // ─── Public passport endpoint ─────────────────────────────────────────────

  async getPublicPassport(token: string): Promise<PublicPassport> {
    const appliance = await this.prisma.client.appliance.findUnique({
      where: { public_token: token },
      include: {
        company: {
          select: {
            id: true, name: true, logo_url: true, phone: true,
            slug: true, concierge_enabled: true,
          },
        },
        customer: {
          select: { name: true },
        },
        gasCertificates: {
          where: { status: 'COMPLETE' },
          orderBy: { inspection_date: 'desc' },
          select: { cert_type: true, inspection_date: true },
          take: 10,
        },
      },
    });

    if (!appliance || appliance.archived) throw new NotFoundException('Passport not found');

    const history = appliance.gasCertificates.map(c => ({
      type: PUBLIC_CERT_TYPES[c.cert_type] ?? c.cert_type,
      date: new Date(c.inspection_date).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }),
    }));

    // Add "Installed" event if we have a date
    if (appliance.installed_date) {
      history.push({
        type: 'Installed',
        date: new Date(appliance.installed_date).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }),
      });
    }

    return {
      company: {
        name: appliance.company.name,
        logo_url: appliance.company.logo_url,
        phone: appliance.company.phone,
        slug: appliance.company.slug,
        concierge_enabled: appliance.company.concierge_enabled,
      },
      appliance: {
        type: appliance.type,
        make: appliance.make,
        model: appliance.model,
        location: appliance.location,
        installed_year: appliance.installed_date
          ? new Date(appliance.installed_date).getFullYear()
          : null,
        next_service_due: appliance.next_service_due
          ? new Date(appliance.next_service_due).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
          : null,
      },
      history,
      public_token: token,
    };
  }

  // ─── Full authed view (engineer/owner) ────────────────────────────────────

  async getFullPassport(token: string, requestingCompanyId: string): Promise<FullPassport> {
    const appliance = await this.prisma.client.appliance.findUnique({
      where: { public_token: token },
      include: {
        company: { select: { id: true, name: true, logo_url: true, phone: true, slug: true, concierge_enabled: true } },
        customer: {
          select: {
            id: true, name: true, email: true, phone: true,
            address_line1: true, address_line2: true, city: true, postcode: true,
          },
        },
        gasCertificates: {
          where: { status: 'COMPLETE' },
          orderBy: { inspection_date: 'desc' },
          select: {
            id: true, cert_type: true, cert_number: true,
            inspection_date: true, next_due_date: true,
            data: true, notes: true,
          },
          take: 20,
        },
        jobs: {
          where: { company_id: requestingCompanyId },
          orderBy: { scheduled_at: 'desc' },
          select: { id: true, title: true, status: true, scheduled_at: true, notes: true },
          take: 10,
        },
      },
    });

    if (!appliance || appliance.archived) throw new NotFoundException('Appliance not found');
    if (appliance.company_id !== requestingCompanyId) throw new NotFoundException('Appliance not found');

    // Extract last readings from most recent boiler service cert
    const lastServiceCert = appliance.gasCertificates.find(c => c.cert_type === 'BOILER_SERVICE');
    const lastReadings = lastServiceCert
      ? extractReadings(lastServiceCert.data as Record<string, unknown>)
      : null;

    const now = new Date();
    const warrantyExpired = appliance.warranty_expiry ? appliance.warranty_expiry < now : null;

    return {
      ...await this.getPublicPassport(token),
      full: {
        id: appliance.id,
        gc_number: appliance.gc_number,
        serial_number: appliance.serial_number,
        warranty_expiry: appliance.warranty_expiry?.toISOString() ?? null,
        warranty_expired: warrantyExpired,
        notes: appliance.notes,
        customer: appliance.customer,
        last_readings: lastReadings,
        certs: appliance.gasCertificates.map(c => ({
          id: c.id,
          cert_type: c.cert_type,
          cert_number: c.cert_number,
          inspection_date: c.inspection_date.toISOString(),
          next_due_date: c.next_due_date?.toISOString() ?? null,
          notes: c.notes,
        })),
        jobs: appliance.jobs,
      },
    };
  }

  // ─── Due soon (for Pip tool) ───────────────────────────────────────────────

  async getDueForCompany(companyId: string, daysAhead: number = 60) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() + daysAhead);
    return this.prisma.client.appliance.findMany({
      where: {
        company_id: companyId,
        archived: false,
        next_service_due: { lte: cutoff },
      },
      include: { customer: { select: { id: true, name: true, phone: true, email: true } } },
      orderBy: { next_service_due: 'asc' },
    });
  }

  // ─── Create from cert prefill ─────────────────────────────────────────────

  /** Extract appliance info from a gas cert's JSON data field */
  static extractFromCert(certData: Record<string, unknown>, certType: string): Partial<CreateApplianceDto> {
    if (certType === 'BOILER_SERVICE') {
      return {
        type: 'BOILER',
        make: certData['boiler_make'] as string | undefined,
        model: certData['boiler_model'] as string | undefined,
        serial_number: certData['boiler_serial'] as string | undefined,
        location: certData['boiler_location'] as string | undefined,
      };
    }
    if (certType === 'INSTALLATION') {
      const makeModel = certData['make_model'] as string | undefined;
      const [make, ...rest] = (makeModel ?? '').split(' ');
      return {
        type: (certData['appliance_type'] as string | undefined) === 'boiler' ? 'BOILER' : 'OTHER',
        make: make || undefined,
        model: rest.join(' ') || undefined,
        serial_number: certData['serial_number'] as string | undefined,
        location: certData['location'] as string | undefined,
      };
    }
    return {};
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  private async verifyCustomer(customerId: string, companyId: string) {
    const c = await this.prisma.client.customer.findFirst({
      where: { id: customerId, company_id: companyId },
    });
    if (!c) throw new NotFoundException('Customer not found');
    return c;
  }

  private async verifyAppliance(id: string, companyId: string) {
    const a = await this.prisma.client.appliance.findFirst({
      where: { id, company_id: companyId },
    });
    if (!a) throw new NotFoundException('Appliance not found');
    return a;
  }
}

// ─── Type helpers ──────────────────────────────────────────────────────────────

export interface PublicPassport {
  company: {
    name: string;
    logo_url: string | null;
    phone: string | null;
    slug: string | null;
    concierge_enabled: boolean;
  };
  appliance: {
    type: string;
    make: string | null;
    model: string | null;
    location: string | null;
    installed_year: number | null;
    next_service_due: string | null;
  };
  history: Array<{ type: string; date: string }>;
  public_token: string;
}

export interface FullPassport extends PublicPassport {
  full: {
    id: string;
    gc_number: string | null;
    serial_number: string | null;
    warranty_expiry: string | null;
    warranty_expired: boolean | null;
    notes: string | null;
    customer: {
      id: string;
      name: string;
      email: string | null;
      phone: string | null;
      address_line1: string | null;
      address_line2: string | null;
      city: string | null;
      postcode: string | null;
    };
    last_readings: Record<string, unknown> | null;
    certs: Array<{
      id: string;
      cert_type: string;
      cert_number: string;
      inspection_date: string;
      next_due_date: string | null;
      notes: string | null;
    }>;
    jobs: Array<{
      id: string;
      title: string;
      status: string;
      scheduled_at: Date | null;
      notes: string | null;
    }>;
  };
}

function extractReadings(data: Record<string, unknown>): Record<string, unknown> {
  const keys = ['co_reading_ppm', 'co2_percentage', 'operating_pressure_mbar', 'gas_rate_m3h', 'overall_result'];
  const result: Record<string, unknown> = {};
  for (const k of keys) {
    if (data[k] !== undefined && data[k] !== null) result[k] = data[k];
  }
  return Object.keys(result).length ? result : {};
}
