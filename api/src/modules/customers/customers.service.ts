import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';

// ── Simple CSV parser (handles quoted fields with commas/newlines) ─────────────

function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let current = '';
  let inQuotes = false;
  let row: string[] = [];

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (ch === '"' && inQuotes && next === '"') {
      current += '"';
      i++;
    } else if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      row.push(current.trim());
      current = '';
    } else if ((ch === '\n' || (ch === '\r' && next === '\n')) && !inQuotes) {
      if (ch === '\r') i++;
      row.push(current.trim());
      if (row.some(c => c !== '')) rows.push(row);
      row = [];
      current = '';
    } else {
      current += ch;
    }
  }
  // flush last row
  row.push(current.trim());
  if (row.some(c => c !== '')) rows.push(row);

  return rows;
}

// Common header aliases (including Tradify export names)
const HEADER_ALIASES: Record<string, string[]> = {
  name:          ['name', 'customer name', 'client name', 'contact name', 'full name', 'company name', 'business name'],
  email:         ['email', 'email address', 'e-mail', 'e-mail address'],
  phone:         ['phone', 'phone number', 'telephone', 'mobile', 'contact number', 'cell'],
  address_line1: ['address', 'address line 1', 'address1', 'street', 'street address', 'address line one'],
  address_line2: ['address line 2', 'address2', 'address line two', 'suburb'],
  city:          ['city', 'town', 'suburb', 'locality'],
  postcode:      ['postcode', 'post code', 'postal code', 'zip', 'zip code'],
  notes:         ['notes', 'note', 'comments', 'description', 'additional info'],
};

function autoGuessMapping(headers: string[]): Record<string, number> {
  const mapping: Record<string, number> = {};
  const normalise = (h: string) => h.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    for (let i = 0; i < headers.length; i++) {
      if (aliases.includes(normalise(headers[i]))) {
        mapping[field] = i;
        break;
      }
    }
  }
  return mapping;
}

// ─────────────────────────────────────────────────────────────────────────────

export interface ImportMapping {
  name: number;
  email?: number;
  phone?: number;
  address_line1?: number;
  address_line2?: number;
  city?: number;
  postcode?: number;
  notes?: number;
}

export interface ImportResult {
  imported: number;
  skipped_dupes: number;
  skipped_invalid: number;
}

@Injectable()
export class CustomersService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: CreateCustomerDto, companyId: string) {
    return this.prisma.client.customer.create({
      data: { ...dto, company_id: companyId },
    });
  }

  findAll(companyId: string) {
    return this.prisma.client.customer.findMany({
      where: { company_id: companyId },
      orderBy: { name: 'asc' },
    });
  }

  async findOne(id: string, companyId: string) {
    const customer = await this.prisma.client.customer.findFirst({
      where: { id, company_id: companyId },
    });
    if (!customer) throw new NotFoundException('Customer not found');
    return customer;
  }

  async update(id: string, dto: UpdateCustomerDto, companyId: string) {
    await this.findOne(id, companyId);
    return this.prisma.client.customer.update({
      where: { id },
      data: dto,
    });
  }

  async remove(id: string, companyId: string) {
    await this.findOne(id, companyId);

    const jobCount = await this.prisma.client.job.count({
      where: { customer_id: id },
    });
    if (jobCount > 0) {
      throw new ConflictException(
        'Cannot delete a customer with existing jobs',
      );
    }

    await this.prisma.client.customer.delete({ where: { id } });
  }

  // ── CSV header preview (parse headers + first 5 rows) ──────────────────────

  parseImportPreview(csvBuffer: Buffer): { headers: string[]; preview: string[][]; guessedMapping: Record<string, number> } {
    const text = csvBuffer.toString('utf-8');
    const rows = parseCsvRows(text);
    if (!rows.length) throw new BadRequestException('CSV file appears to be empty');
    const headers = rows[0];
    const preview = rows.slice(1, 6);
    const guessedMapping = autoGuessMapping(headers);
    return { headers, preview, guessedMapping };
  }

  // ── Full CSV import ─────────────────────────────────────────────────────────

  async importFromCsv(
    csvBuffer: Buffer,
    mapping: ImportMapping,
    companyId: string,
  ): Promise<ImportResult & { first_import: boolean }> {
    const text = csvBuffer.toString('utf-8');
    const rows = parseCsvRows(text);

    if (!rows.length) throw new BadRequestException('CSV file appears to be empty');

    const dataRows = rows.slice(1); // skip header row
    if (!dataRows.length) throw new BadRequestException('No data rows found in CSV');

    // Fetch existing customers for dedup (name+postcode OR email)
    const existing = await this.prisma.client.customer.findMany({
      where: { company_id: companyId },
      select: { name: true, postcode: true, email: true },
    });

    const existingEmailSet = new Set(
      existing.filter(c => c.email).map(c => c.email!.toLowerCase()),
    );
    const existingNamePostcodeSet = new Set(
      existing
        .filter(c => c.name && c.postcode)
        .map(c => `${c.name.toLowerCase()}|${c.postcode!.toLowerCase()}`),
    );

    let imported = 0;
    let skipped_dupes = 0;
    let skipped_invalid = 0;

    for (const row of dataRows) {
      const get = (idx: number | undefined) =>
        idx !== undefined && idx < row.length ? (row[idx] ?? '').trim() : '';

      const name = get(mapping.name);
      if (!name) { skipped_invalid++; continue; }

      const email     = get(mapping.email)     || undefined;
      const phone     = get(mapping.phone)     || undefined;
      const address1  = get(mapping.address_line1) || undefined;
      const address2  = get(mapping.address_line2) || undefined;
      const city      = get(mapping.city)      || undefined;
      const rawPostcode = get(mapping.postcode) || undefined;
      // Normalise postcode to uppercase with single space
      const postcode  = rawPostcode
        ? rawPostcode.toUpperCase().replace(/\s+/g, ' ').replace(/([A-Z0-9]+)([A-Z0-9]{3})$/, '$1 $2').trim()
        : undefined;
      const notes     = get(mapping.notes)     || undefined;

      // Dedupe check
      const emailDupe = email && existingEmailSet.has(email.toLowerCase());
      const namePcDupe = name && postcode && existingNamePostcodeSet.has(`${name.toLowerCase()}|${postcode.toLowerCase()}`);
      if (emailDupe || namePcDupe) { skipped_dupes++; continue; }

      await this.prisma.client.customer.create({
        data: { company_id: companyId, name, email, phone, address_line1: address1, address_line2: address2, city, postcode, notes },
      });

      // Add to local dupe sets so later rows in same import are also deduped
      if (email) existingEmailSet.add(email.toLowerCase());
      if (name && postcode) existingNamePostcodeSet.add(`${name.toLowerCase()}|${postcode.toLowerCase()}`);

      imported++;
    }

    // Mark first_import_done on company if this produced any imports
    let first_import = false;
    if (imported > 0) {
      const company = await this.prisma.client.company.findUnique({
        where: { id: companyId },
        select: { first_import_done: true },
      });
      if (!company?.first_import_done) {
        await this.prisma.client.company.update({
          where: { id: companyId },
          data: { first_import_done: true },
        });
        first_import = true;
      }
    }

    return { imported, skipped_dupes, skipped_invalid, first_import };
  }
}
