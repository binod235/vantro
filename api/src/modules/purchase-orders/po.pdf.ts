import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

function getLogoBase64(logoUrl: string | null): string | null {
  if (!logoUrl) return null;
  try {
    const filePath = join(process.cwd(), logoUrl.replace(/^\//, ''));
    if (!existsSync(filePath)) return null;
    const buf  = readFileSync(filePath);
    const ext  = (logoUrl.split('.').pop() ?? 'png').toLowerCase();
    const mime =
      ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' :
      ext === 'webp' ? 'image/webp' : 'image/png';
    return `data:${mime};base64,${buf.toString('base64')}`;
  } catch { return null; }
}

const gbp = (pence: number) =>
  new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(pence / 100);

const fmtDate = (d?: string | Date | null): string => {
  if (!d) return '—';
  return new Date(d as string).toLocaleDateString('en-GB', {
    day: '2-digit', month: 'long', year: 'numeric',
  });
};

const STATUS_META: Record<string, { label: string; bg: string; color: string }> = {
  DRAFT:     { label: 'Draft',     bg: '#f1f5f9', color: '#475569' },
  SENT:      { label: 'Sent',      bg: '#dbeafe', color: '#1d4ed8' },
  RECEIVED:  { label: 'Received',  bg: '#dcfce7', color: '#16a34a' },
  CANCELLED: { label: 'Cancelled', bg: '#fee2e2', color: '#dc2626' },
};

function statusBadge(status: string): string {
  const s = STATUS_META[status] ?? { label: status, bg: '#f1f5f9', color: '#555' };
  return `<span style="background:${s.bg};color:${s.color};padding:3px 10px;border-radius:20px;font-size:11px;font-weight:bold;text-transform:uppercase;letter-spacing:0.5px;">${s.label}</span>`;
}

function buildLineRows(items: any[]): string {
  if (!items?.length) {
    return `<tr><td colspan="4" style="padding:20px;text-align:center;color:#999;font-size:12px;">No line items</td></tr>`;
  }
  return items.map((it: any) => `<tr>
    <td style="padding:9px 12px;border-bottom:1px solid #f0f0f0;font-size:13px;">${it.description ?? ''}</td>
    <td style="padding:9px 12px;border-bottom:1px solid #f0f0f0;text-align:center;font-size:13px;">${it.quantity ?? 1}</td>
    <td style="padding:9px 12px;border-bottom:1px solid #f0f0f0;text-align:right;font-size:13px;">${gbp(it.unit_cost_pence ?? 0)}</td>
    <td style="padding:9px 12px;border-bottom:1px solid #f0f0f0;text-align:right;font-size:13px;">${gbp(it.total_cost_pence ?? 0)}</td>
  </tr>`).join('');
}

export function buildPoHtml(po: any, company: any): string {
  const accent  = company.invoice_accent_colour ?? '#1d4ed8';
  const showLogo = company.invoice_show_logo !== false;
  const logoSrc  = showLogo ? getLogoBase64(company.logo_url) : null;

  const coAddr = [company.address_line1, company.address_line2, company.city, company.postcode]
    .filter(Boolean).join(', ');

  const supplierAddr = po.supplier
    ? [po.supplier.address_line1, po.supplier.city, po.supplier.postcode]
        .filter(Boolean).join('<br>')
    : '';

  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,Helvetica,sans-serif;color:#1a1a1a;background:white;font-size:13px;line-height:1.5;-webkit-print-color-adjust:exact;print-color-adjust:exact}</style>
</head><body>

<div style="background:${accent};padding:36px 44px;-webkit-print-color-adjust:exact;print-color-adjust:exact;">
  <table style="width:100%;border-collapse:collapse;"><tr>
    <td style="vertical-align:middle;">
      ${logoSrc ? `<img src="${logoSrc}" alt="logo" style="max-height:56px;max-width:160px;object-fit:contain;display:block;margin-bottom:10px;">` : ''}
      <div style="color:white;font-size:22px;font-weight:bold;">${company.name ?? ''}</div>
      ${coAddr ? `<div style="color:rgba(255,255,255,0.8);font-size:11px;margin-top:4px;">${coAddr}</div>` : ''}
      ${company.phone ? `<div style="color:rgba(255,255,255,0.75);font-size:11px;">${company.phone}</div>` : ''}
    </td>
    <td style="text-align:right;vertical-align:top;">
      <div style="color:white;font-size:40px;font-weight:bold;letter-spacing:-1px;line-height:1;">PURCHASE ORDER</div>
      <div style="color:rgba(255,255,255,0.9);font-size:18px;margin-top:6px;font-weight:500;">${po.po_number ?? ''}</div>
      <div style="margin-top:8px;">${statusBadge(po.status)}</div>
    </td>
  </tr></table>
</div>

<div style="padding:32px 44px 24px;">
  <table style="width:100%;border-collapse:collapse;"><tr>
    <td style="width:52%;vertical-align:top;padding-right:40px;">
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:1.5px;color:#aaa;margin-bottom:8px;font-weight:600;">Supplier</div>
      <div style="font-size:15px;font-weight:bold;color:#111;">${po.supplier?.name ?? '—'}</div>
      ${supplierAddr ? `<div style="color:#666;font-size:12px;margin-top:6px;line-height:1.7;">${supplierAddr}</div>` : ''}
      ${po.supplier?.email ? `<div style="color:#666;font-size:12px;margin-top:4px;">${po.supplier.email}</div>` : ''}
      ${po.supplier?.phone ? `<div style="color:#666;font-size:12px;">${po.supplier.phone}</div>` : ''}
    </td>
    <td style="vertical-align:top;">
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:1.5px;color:#aaa;margin-bottom:8px;font-weight:600;">Deliver To</div>
      <div style="font-size:14px;font-weight:bold;color:#111;">${company.name ?? ''}</div>
      ${coAddr ? `<div style="color:#666;font-size:12px;margin-top:4px;line-height:1.7;">${coAddr.replace(/, /g, '<br>')}</div>` : ''}
      ${po.job ? `<div style="margin-top:8px;font-size:12px;color:#555;">Job: <strong>${po.job.title}</strong></div>` : ''}
      <div style="margin-top:10px;">
        <table style="border-collapse:collapse;font-size:12px;">
          <tr><td style="color:#999;padding:3px 20px 3px 0;white-space:nowrap;">PO Date</td><td style="font-weight:600;">${fmtDate(po.created_at)}</td></tr>
          ${po.expected_date ? `<tr><td style="color:#999;padding:3px 20px 3px 0;">Required By</td><td style="font-weight:600;color:#b45309;">${fmtDate(po.expected_date)}</td></tr>` : ''}
        </table>
      </div>
    </td>
  </tr></table>
</div>

<div style="padding:0 44px;">
  <table style="width:100%;border-collapse:collapse;">
    <thead><tr style="background:${accent};-webkit-print-color-adjust:exact;print-color-adjust:exact;">
      <th style="padding:10px 12px;text-align:left;color:white;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;font-weight:600;">Description</th>
      <th style="padding:10px 12px;text-align:center;color:white;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;font-weight:600;width:55px;">Qty</th>
      <th style="padding:10px 12px;text-align:right;color:white;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;font-weight:600;width:110px;">Unit Cost</th>
      <th style="padding:10px 12px;text-align:right;color:white;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;font-weight:600;width:110px;">Total</th>
    </tr></thead>
    <tbody>${buildLineRows(po.line_items ?? [])}</tbody>
    <tfoot>
      <tr><td colspan="4" style="padding:8px 0;"></td></tr>
      <tr>
        <td colspan="3" style="padding:10px 12px;text-align:right;font-weight:bold;font-size:16px;border-top:2px solid #e5e5e5;">Total</td>
        <td style="padding:10px 12px;text-align:right;font-weight:bold;font-size:16px;border-top:2px solid #e5e5e5;">${gbp(po.total_pence ?? 0)}</td>
      </tr>
    </tfoot>
  </table>
</div>

<div style="padding:24px 44px 40px;">
  ${po.notes ? `<div style="margin-bottom:16px;"><div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#aaa;margin-bottom:6px;font-weight:600;">Notes</div><div style="font-size:12px;color:#555;white-space:pre-line;line-height:1.6;">${po.notes}</div></div>` : ''}
</div>

<div style="border-top:1px solid #eee;padding:14px 44px;background:#fafafa;-webkit-print-color-adjust:exact;print-color-adjust:exact;">
  <div style="font-size:11px;color:#bbb;text-align:center;">
    PO Number: <strong style="color:#888;">${po.po_number}</strong>
    ${po.expected_date ? ` &middot; Required By: <strong style="color:#888;">${fmtDate(po.expected_date)}</strong>` : ''}
    &middot; ${[company.name, company.address_line1, company.postcode, company.phone].filter(Boolean).join(' &middot; ')}
  </div>
</div>

</body></html>`;
}
