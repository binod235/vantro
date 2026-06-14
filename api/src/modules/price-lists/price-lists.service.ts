import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

function calcSellPrice(costPence: number, markupPercent: number): number {
  return Math.round(costPence * (1 + markupPercent / 100));
}

@Injectable()
export class PriceListsService {
  constructor(private readonly prisma: PrismaService) {}

  // ── Price List Items ──────────────────────────────────────────────────────

  async listItems(
    companyId: string,
    filters?: { supplier_id?: string; search?: string },
  ) {
    const where: Record<string, unknown> = {
      company_id: companyId,
      is_active:  true,
    };
    if (filters?.supplier_id) where.supplier_id = filters.supplier_id;
    if (filters?.search) {
      where.OR = [
        { name:      { contains: filters.search, mode: 'insensitive' } },
        { item_code: { contains: filters.search, mode: 'insensitive' } },
      ];
    }
    return this.prisma.client.priceListItem.findMany({
      where,
      include: { supplier: { select: { id: true, name: true } } },
      orderBy: { name: 'asc' },
    });
  }

  async createItem(companyId: string, dto: {
    name: string;
    description?: string;
    item_code?: string;
    unit?: string;
    supplier_id?: string;
    cost_price_pence: number;
    markup_percent: number;
    vat_type?: string;
    vat_rate?: number;
  }) {
    const sellPrice = calcSellPrice(dto.cost_price_pence, dto.markup_percent);
    return this.prisma.client.priceListItem.create({
      data: {
        company_id:       companyId,
        supplier_id:      dto.supplier_id ?? null,
        name:             dto.name,
        description:      dto.description ?? null,
        item_code:        dto.item_code ?? null,
        unit:             dto.unit ?? null,
        cost_price_pence: dto.cost_price_pence,
        markup_percent:   dto.markup_percent,
        sell_price_pence: sellPrice,
        vat_type:         dto.vat_type ?? 'STANDARD',
        vat_rate:         dto.vat_rate ?? 20,
      },
      include: { supplier: { select: { id: true, name: true } } },
    });
  }

  async updateItem(companyId: string, itemId: string, dto: Partial<{
    name: string;
    description: string;
    item_code: string;
    unit: string;
    supplier_id: string | null;
    cost_price_pence: number;
    markup_percent: number;
    vat_type: string;
    vat_rate: number;
    is_active: boolean;
  }>) {
    const item = await this.prisma.client.priceListItem.findFirst({
      where: { id: itemId, company_id: companyId },
    });
    if (!item) throw new NotFoundException('Item not found');

    const costPrice = dto.cost_price_pence ?? item.cost_price_pence;
    const markup    = dto.markup_percent   ?? item.markup_percent;
    const sellPrice = calcSellPrice(costPrice, markup);

    return this.prisma.client.priceListItem.update({
      where: { id: itemId },
      data:  { ...dto, sell_price_pence: sellPrice },
      include: { supplier: { select: { id: true, name: true } } },
    });
  }

  async deleteItem(companyId: string, itemId: string): Promise<void> {
    const item = await this.prisma.client.priceListItem.findFirst({
      where: { id: itemId, company_id: companyId },
    });
    if (!item) throw new NotFoundException('Item not found');
    await this.prisma.client.priceListItem.update({
      where: { id: itemId },
      data:  { is_active: false },
    });
  }

  // ── CSV Import ────────────────────────────────────────────────────────────

  async importFromCsv(
    companyId: string,
    supplierId: string | null,
    rows: {
      name: string;
      item_code?: string;
      cost_price?: string;
      markup_percent?: string;
      unit?: string;
      vat_rate?: string;
    }[],
  ) {
    let imported = 0;
    let skipped  = 0;

    for (const row of rows) {
      if (!row.name?.trim()) { skipped++; continue; }

      const costPence = Math.round(parseFloat(row.cost_price ?? '0') * 100) || 0;
      const markup    = parseInt(row.markup_percent ?? '20') || 20;
      const sellPrice = calcSellPrice(costPence, markup);

      const existing = await this.prisma.client.priceListItem.findFirst({
        where: {
          company_id: companyId,
          ...(row.item_code?.trim()
            ? { item_code: row.item_code.trim() }
            : { name: row.name.trim() }),
        },
        select: { id: true },
      });

      if (existing) {
        await this.prisma.client.priceListItem.update({
          where: { id: existing.id },
          data: {
            supplier_id:      supplierId,
            cost_price_pence: costPence,
            markup_percent:   markup,
            sell_price_pence: sellPrice,
            is_active:        true,
          },
        });
      } else {
        await this.prisma.client.priceListItem.create({
          data: {
            company_id:       companyId,
            supplier_id:      supplierId,
            name:             row.name.trim(),
            item_code:        row.item_code?.trim() || null,
            unit:             row.unit?.trim() || null,
            cost_price_pence: costPence,
            markup_percent:   markup,
            sell_price_pence: sellPrice,
            vat_rate:         parseInt(row.vat_rate ?? '20') || 20,
          },
        });
      }
      imported++;
    }

    return { imported, skipped };
  }

  // ── Kits ──────────────────────────────────────────────────────────────────

  async listKits(companyId: string) {
    return this.prisma.client.kit.findMany({
      where:   { company_id: companyId, is_active: true },
      orderBy: { name: 'asc' },
    });
  }

  async createKit(companyId: string, dto: {
    name: string;
    description?: string;
    items: {
      price_list_item_id?: string;
      description: string;
      quantity: number;
      unit_price_pence: number;
      vat_type: string;
      vat_rate: number;
    }[];
  }) {
    const totalSell = dto.items.reduce(
      (s, i) => s + Math.round(i.quantity * i.unit_price_pence), 0,
    );

    return this.prisma.client.kit.create({
      data: {
        company_id:       companyId,
        name:             dto.name,
        description:      dto.description ?? null,
        items:            dto.items as never,
        total_sell_pence: totalSell,
      },
    });
  }

  async updateKit(companyId: string, kitId: string, dto: {
    name?: string;
    description?: string;
    items?: {
      price_list_item_id?: string;
      description: string;
      quantity: number;
      unit_price_pence: number;
      vat_type: string;
      vat_rate: number;
    }[];
  }) {
    const kit = await this.prisma.client.kit.findFirst({
      where: { id: kitId, company_id: companyId },
    });
    if (!kit) throw new NotFoundException('Kit not found');

    const items     = dto.items ?? (kit.items as never[]);
    const totalSell = (items as { quantity: number; unit_price_pence: number }[]).reduce(
      (s, i) => s + Math.round(i.quantity * i.unit_price_pence), 0,
    );

    return this.prisma.client.kit.update({
      where: { id: kitId },
      data: {
        name:             dto.name,
        description:      dto.description,
        items:            items as never,
        total_sell_pence: totalSell,
      },
    });
  }

  async deleteKit(companyId: string, kitId: string): Promise<void> {
    const kit = await this.prisma.client.kit.findFirst({
      where: { id: kitId, company_id: companyId },
    });
    if (!kit) throw new NotFoundException('Kit not found');
    await this.prisma.client.kit.update({
      where: { id: kitId },
      data:  { is_active: false },
    });
  }
}
