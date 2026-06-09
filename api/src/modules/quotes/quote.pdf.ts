import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getLogoBase64(logoUrl: string | null): string | null {
  if (!logoUrl) return null;
  try {
    const filePath = join(process.cwd(), logoUrl.replace(/^\//, ''));
    if (!existsSync(filePath)) return null;
    const buf = readFileSync(filePath);
    const ext = (logoUrl.split('.').pop() ?? 'png').toLowerCase();
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
  return new Date(d as string).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });
};

const STATUS_LABELS: Record<string, { label: string; bg: string; color: string }> = {
  DRAFT:    { label: 'Draft',    bg: '#f1f5f9', color: '#475569' },
  SENT:     { label: 'Sent',     bg: '#dbeafe', color: '#1d4ed8' },
  ACCEPTED: { label: 'Accepted', bg: '#dcfce7', color: '#16a34a' },
  REJECTED: { label: 'Declined', bg: '#fee2e2', color: '#dc2626' },
  INVOICED: { label: 'Invoiced', bg: '#f3e8ff', color: '#7c3aed' },
  EXPIRED:  { label: 'Expired',  bg: '#fef3c7', color: '#b45309' },
  CANCELLED:{ label: 'Cancelled',bg: '#f1f5f9', color: '#94a3b8' },
};

function buildLineRows(items: any[]): string {
  if (!items?.length) return `<tr><td colspan="5" style="padding:20px;text-align:center;color:#999;font-size:12px;">No line items</td></tr>`;
  return items.map((it: any) => {
    const vatLabel =
      it.vat_type === 'STANDARD'       ? `${it.vat_rate ?? 20}%` :
      it.vat_type === 'REVERSE_CHARGE' ? 'RC' :
      it.vat_type === 'EXEMPT'         ? 'Exempt' : 'Zero';
    return `<tr>
      <td style="padding:9px 12px;border-bottom:1px solid #f0f0f0;font-size:13px;">${it.description ?? ''}</td>
      <td style="padding:9px 12px;border-bottom:1px solid #f0f0f0;text-align:center;font-size:13px;">${it.quantity ?? 1}</td>
      <td style="padding:9px 12px;border-bottom:1px solid #f0f0f0;text-align:right;font-size:13px;">${gbp(it.unit_price_pence ?? 0)}</td>
      <td style="padding:9px 12px;border-bottom:1px solid #f0f0f0;text-align:center;color:#666;font-size:11px;">${vatLabel}</td>
      <td style="padding:9px 12px;border-bottom:1px solid #f0f0f0;text-align:right;font-size:13px;">${gbp(it.net_pence ?? 0)}</td>
    </tr>`;
  }).join('');
}

function buildTotalsRows(q: any): string {
  let html = `
    <tr><td colspan="4" style="padding:6px 12px;text-align:right;color:#666;font-size:12px;">Subtotal</td><td style="padding:6px 12px;text-align:right;font-size:12px;">${gbp(q.subtotal_pence ?? 0)}</td></tr>
    <tr><td colspan="4" style="padding:6px 12px;text-align:right;color:#666;font-size:12px;">VAT</td><td style="padding:6px 12px;text-align:right;font-size:12px;">${gbp(q.vat_amount_pence ?? 0)}</td></tr>`;
  if (q.is_reverse_charge && (q.reverse_charge_vat_pence ?? 0) > 0) {
    html += `<tr><td colspan="4" style="padding:6px 12px;text-align:right;color:#b45309;font-size:12px;">Reverse Charge VAT (not payable)</td><td style="padding:6px 12px;text-align:right;color:#b45309;font-size:12px;">${gbp(q.reverse_charge_vat_pence)}</td></tr>`;
  }
  html += `<tr><td colspan="4" style="padding:10px 12px;text-align:right;font-weight:bold;font-size:16px;border-top:2px solid #e5e5e5;">Total</td><td style="padding:10px 12px;text-align:right;font-weight:bold;font-size:16px;border-top:2px solid #e5e5e5;">${gbp(q.total_pence ?? 0)}</td></tr>`;
  return html;
}

function statusBadge(status: string): string {
  const s = STATUS_LABELS[status] ?? { label: status, bg: '#f1f5f9', color: '#555' };
  return `<span style="background:${s.bg};color:${s.color};padding:3px 10px;border-radius:20px;font-size:11px;font-weight:bold;text-transform:uppercase;letter-spacing:0.5px;">${s.label}</span>`;
}

const TABLE_COLS = `
  <th style="padding:10px 12px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;font-weight:600;">Description</th>
  <th style="padding:10px 12px;text-align:center;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;font-weight:600;width:55px;">Qty</th>
  <th style="padding:10px 12px;text-align:right;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;font-weight:600;width:100px;">Unit Price</th>
  <th style="padding:10px 12px;text-align:center;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;font-weight:600;width:65px;">VAT</th>
  <th style="padding:10px 12px;text-align:right;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;font-weight:600;width:100px;">Amount</th>`;

// ─── MODERN template ──────────────────────────────────────────────────────────

function buildModern(q: any, co: any, accent: string, logoSrc: string | null): string {
  const coAddr = [co.address_line1, co.address_line2, co.city, co.postcode].filter(Boolean).join(', ');
  const custAddr = [q.customer?.address_line1, q.customer?.address_line2, q.customer?.city, q.customer?.postcode].filter(Boolean).join('<br>');

  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,Helvetica,sans-serif;color:#1a1a1a;background:white;font-size:13px;line-height:1.5;-webkit-print-color-adjust:exact;print-color-adjust:exact}</style>
</head><body>
<div style="background:${accent};padding:36px 44px;-webkit-print-color-adjust:exact;print-color-adjust:exact;">
  <table style="width:100%;border-collapse:collapse;"><tr>
    <td style="vertical-align:middle;">
      ${logoSrc ? `<img src="${logoSrc}" alt="logo" style="max-height:56px;max-width:160px;object-fit:contain;display:block;margin-bottom:10px;">` : ''}
      <div style="color:white;font-size:22px;font-weight:bold;">${co.name ?? ''}</div>
      ${coAddr ? `<div style="color:rgba(255,255,255,0.8);font-size:11px;margin-top:4px;">${coAddr}</div>` : ''}
      ${co.phone ? `<div style="color:rgba(255,255,255,0.75);font-size:11px;">${co.phone}</div>` : ''}
      ${co.vat_registered && co.vat_number ? `<div style="color:rgba(255,255,255,0.7);font-size:11px;">VAT No: ${co.vat_number}</div>` : ''}
    </td>
    <td style="text-align:right;vertical-align:top;">
      <div style="color:white;font-size:40px;font-weight:bold;letter-spacing:-1px;line-height:1;">QUOTE</div>
      <div style="color:rgba(255,255,255,0.9);font-size:18px;margin-top:6px;font-weight:500;">${q.quote_number ?? ''}</div>
      <div style="margin-top:8px;">${statusBadge(q.status)}</div>
    </td>
  </tr></table>
</div>

<div style="padding:32px 44px 24px;">
  <table style="width:100%;border-collapse:collapse;"><tr>
    <td style="width:52%;vertical-align:top;padding-right:40px;">
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:1.5px;color:#aaa;margin-bottom:8px;font-weight:600;">Prepared For</div>
      <div style="font-size:15px;font-weight:bold;color:#111;">${q.customer?.name ?? ''}</div>
      ${custAddr ? `<div style="color:#666;font-size:12px;margin-top:6px;line-height:1.7;">${custAddr}</div>` : ''}
      ${q.customer?.email ? `<div style="color:#666;font-size:12px;margin-top:4px;">${q.customer.email}</div>` : ''}
      ${q.customer?.phone ? `<div style="color:#666;font-size:12px;">${q.customer.phone}</div>` : ''}
    </td>
    <td style="vertical-align:top;">
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:1.5px;color:#aaa;margin-bottom:8px;font-weight:600;">Quote Details</div>
      <table style="border-collapse:collapse;font-size:12px;">
        <tr><td style="color:#999;padding:3px 20px 3px 0;white-space:nowrap;">Issue Date</td><td style="font-weight:600;">${fmtDate(q.issue_date)}</td></tr>
        <tr><td style="color:#999;padding:3px 20px 3px 0;">Valid Until</td><td style="font-weight:600;color:${q.expiry_date && new Date(q.expiry_date) < new Date() ? '#dc2626' : '#222'};">${fmtDate(q.expiry_date)}</td></tr>
        ${q.reference ? `<tr><td style="color:#999;padding:3px 20px 3px 0;">Reference</td><td style="font-weight:600;">${q.reference}</td></tr>` : ''}
        ${q.job ? `<tr><td style="color:#999;padding:3px 20px 3px 0;">Job</td><td style="font-weight:600;">${q.job.title}</td></tr>` : ''}
      </table>
    </td>
  </tr></table>
</div>

<div style="padding:0 44px;">
  <table style="width:100%;border-collapse:collapse;">
    <thead><tr style="background:${accent};-webkit-print-color-adjust:exact;print-color-adjust:exact;">
      ${TABLE_COLS.replace(/;font-size:11px/g, ';color:white;font-size:11px')}
    </tr></thead>
    <tbody>${buildLineRows(q.line_items ?? [])}</tbody>
    <tfoot>
      <tr><td colspan="5" style="padding:8px 0;"></td></tr>
      ${buildTotalsRows(q)}
    </tfoot>
  </table>
</div>

<div style="padding:24px 44px 40px;">
  ${q.notes ? `<div style="margin-bottom:16px;"><div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#aaa;margin-bottom:6px;font-weight:600;">Notes</div><div style="font-size:12px;color:#555;white-space:pre-line;line-height:1.6;">${q.notes}</div></div>` : ''}
  ${q.is_reverse_charge ? `<div style="background:#fffbeb;border:1px solid #fcd34d;border-radius:6px;padding:12px 16px;margin-top:8px;"><div style="font-size:12px;color:#92400e;font-weight:500;">&#9888; ${q.reverse_charge_wording ?? 'Reverse charge: customer to account for VAT to HMRC.'}</div></div>` : ''}
  ${q.expiry_date ? `<div style="margin-top:16px;background:#f0f9ff;border:1px solid #bae6fd;border-radius:6px;padding:12px 16px;"><div style="font-size:12px;color:#0369a1;">This quote is valid until <strong>${fmtDate(q.expiry_date)}</strong>. Please contact us if you have any questions.</div></div>` : ''}
</div>

<div style="border-top:1px solid #eee;padding:14px 44px;background:#fafafa;-webkit-print-color-adjust:exact;print-color-adjust:exact;">
  <div style="font-size:11px;color:#bbb;text-align:center;">
    ${[co.name, co.address_line1, co.postcode, co.phone, co.vat_registered && co.vat_number ? `VAT: ${co.vat_number}` : null].filter(Boolean).join(' &middot; ')}
  </div>
</div>
</body></html>`;
}

// ─── CLASSIC template ─────────────────────────────────────────────────────────

function buildClassic(q: any, co: any, accent: string, logoSrc: string | null): string {
  const coAddr = [co.address_line1, co.address_line2, co.city, co.postcode].filter(Boolean);
  const custAddr = [q.customer?.address_line1, q.customer?.address_line2, q.customer?.city, q.customer?.postcode].filter(Boolean);

  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,Helvetica,sans-serif;color:#1a1a1a;background:white;font-size:13px;line-height:1.5;-webkit-print-color-adjust:exact;print-color-adjust:exact}</style>
</head><body>
<div style="padding:40px 44px 0;">
  <table style="width:100%;border-collapse:collapse;"><tr>
    <td style="vertical-align:top;width:50%;">
      ${logoSrc ? `<img src="${logoSrc}" alt="logo" style="max-height:64px;max-width:180px;object-fit:contain;display:block;margin-bottom:12px;">` : ''}
      <div style="font-size:18px;font-weight:bold;color:#111;">${co.name ?? ''}</div>
      ${coAddr.map((l: string) => `<div style="font-size:12px;color:#666;">${l}</div>`).join('')}
      ${co.phone ? `<div style="font-size:12px;color:#666;">${co.phone}</div>` : ''}
      ${co.vat_registered && co.vat_number ? `<div style="font-size:12px;color:#666;">VAT No: ${co.vat_number}</div>` : ''}
    </td>
    <td style="text-align:right;vertical-align:top;">
      <div style="font-size:42px;font-weight:bold;color:${accent};letter-spacing:-2px;line-height:1;">QUOTE</div>
      <div style="font-size:14px;color:#555;margin-top:6px;">${q.quote_number ?? ''}</div>
      <div style="margin-top:8px;">${statusBadge(q.status)}</div>
    </td>
  </tr></table>
</div>
<div style="margin:24px 44px 0;border-top:2px solid ${accent};"></div>
<div style="background:#f8f9fa;padding:12px 44px;">
  <table style="width:100%;border-collapse:collapse;font-size:12px;"><tr>
    <td style="width:25%;"><span style="color:#999;">Issue Date</span><br><strong>${fmtDate(q.issue_date)}</strong></td>
    <td style="width:25%;"><span style="color:#999;">Valid Until</span><br><strong style="color:${q.expiry_date && new Date(q.expiry_date) < new Date() ? '#dc2626' : '#222'};">${fmtDate(q.expiry_date)}</strong></td>
    ${q.reference ? `<td style="width:25%;"><span style="color:#999;">Reference</span><br><strong>${q.reference}</strong></td>` : '<td></td>'}
    <td style="text-align:right;">${statusBadge(q.status)}</td>
  </tr></table>
</div>
<div style="padding:28px 44px 24px;">
  <div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#aaa;margin-bottom:8px;font-weight:600;">Prepared For</div>
  <div style="font-size:14px;font-weight:bold;">${q.customer?.name ?? ''}</div>
  ${custAddr.map((l: string) => `<div style="font-size:12px;color:#666;">${l}</div>`).join('')}
  ${q.customer?.email ? `<div style="font-size:12px;color:#666;">${q.customer.email}</div>` : ''}
</div>
<div style="padding:0 44px;">
  <table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;">
    <thead><tr style="background:${accent};-webkit-print-color-adjust:exact;print-color-adjust:exact;">
      ${TABLE_COLS.replace(/;font-size:11px/g, ';color:white;font-size:11px')}
    </tr></thead>
    <tbody>${buildLineRows(q.line_items ?? [])}</tbody>
    <tfoot><tr><td colspan="5" style="padding:8px 0;"></td></tr>${buildTotalsRows(q)}</tfoot>
  </table>
</div>
<div style="padding:24px 44px 40px;">
  ${q.notes ? `<div style="margin-bottom:12px;font-size:12px;color:#555;white-space:pre-line;">${q.notes}</div>` : ''}
  ${q.expiry_date ? `<div style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:6px;padding:10px 14px;margin-top:8px;font-size:12px;color:#0369a1;">This quote is valid until <strong>${fmtDate(q.expiry_date)}</strong>.</div>` : ''}
</div>
<div style="border-top:2px solid ${accent};padding:14px 44px;">
  <div style="font-size:11px;color:#999;text-align:center;">${[co.name, co.address_line1, co.postcode, co.phone].filter(Boolean).join(' &middot; ')}</div>
</div>
</body></html>`;
}

// ─── MINIMAL template ─────────────────────────────────────────────────────────

function buildMinimal(q: any, co: any, accent: string, logoSrc: string | null): string {
  const coAddr = [co.address_line1, co.city, co.postcode].filter(Boolean).join(', ');
  const custAddr = [q.customer?.address_line1, q.customer?.city, q.customer?.postcode].filter(Boolean).join(', ');

  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,Helvetica,sans-serif;color:#1a1a1a;background:white;font-size:13px;line-height:1.5;-webkit-print-color-adjust:exact;print-color-adjust:exact}</style>
</head><body>
<div style="padding:44px 50px 28px;">
  <table style="width:100%;border-collapse:collapse;"><tr>
    <td style="vertical-align:top;">
      ${logoSrc ? `<img src="${logoSrc}" alt="logo" style="max-height:52px;max-width:160px;object-fit:contain;display:block;margin-bottom:10px;">` : ''}
      <div style="font-size:18px;font-weight:bold;">${co.name ?? ''}</div>
      ${coAddr ? `<div style="font-size:11px;color:#999;margin-top:3px;">${coAddr}</div>` : ''}
      ${co.vat_registered && co.vat_number ? `<div style="font-size:11px;color:#999;">VAT: ${co.vat_number}</div>` : ''}
    </td>
    <td style="text-align:right;vertical-align:top;">
      <div style="font-size:11px;text-transform:uppercase;letter-spacing:2px;color:${accent};font-weight:600;margin-bottom:6px;">Quotation</div>
      <div style="font-size:28px;font-weight:bold;letter-spacing:-0.5px;">${q.quote_number ?? ''}</div>
      <div style="margin-top:6px;">${statusBadge(q.status)}</div>
    </td>
  </tr></table>
</div>
<div style="margin:0 50px;border-top:1px solid #e5e7eb;"></div>
<div style="padding:28px 50px;">
  <table style="width:100%;border-collapse:collapse;"><tr>
    <td style="width:40%;vertical-align:top;padding-right:40px;">
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:1.5px;color:#ccc;margin-bottom:8px;font-weight:600;">Prepared For</div>
      <div style="font-size:14px;font-weight:bold;">${q.customer?.name ?? ''}</div>
      ${custAddr ? `<div style="font-size:12px;color:#888;margin-top:4px;">${custAddr}</div>` : ''}
      ${q.customer?.email ? `<div style="font-size:12px;color:#888;">${q.customer.email}</div>` : ''}
    </td>
    <td style="vertical-align:top;">
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:1.5px;color:#ccc;margin-bottom:8px;font-weight:600;">Details</div>
      <table style="border-collapse:collapse;font-size:12px;">
        <tr><td style="color:#bbb;padding:3px 20px 3px 0;">Issue Date</td><td style="color:#333;">${fmtDate(q.issue_date)}</td></tr>
        <tr><td style="color:#bbb;padding:3px 20px 3px 0;">Valid Until</td><td style="color:${q.expiry_date && new Date(q.expiry_date) < new Date() ? '#dc2626' : '#333'};">${fmtDate(q.expiry_date)}</td></tr>
        ${q.reference ? `<tr><td style="color:#bbb;padding:3px 20px 3px 0;">Reference</td><td style="color:#333;">${q.reference}</td></tr>` : ''}
      </table>
    </td>
  </tr></table>
</div>
<div style="margin:0 50px;border-top:1px solid #e5e7eb;"></div>
<div style="padding:0 50px;">
  <table style="width:100%;border-collapse:collapse;">
    <thead><tr>
      <th style="padding:12px 8px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:1.5px;color:${accent};font-weight:600;border-bottom:1px solid #e5e7eb;">Description</th>
      <th style="padding:12px 8px;text-align:center;font-size:10px;text-transform:uppercase;letter-spacing:1.5px;color:${accent};font-weight:600;border-bottom:1px solid #e5e7eb;width:55px;">Qty</th>
      <th style="padding:12px 8px;text-align:right;font-size:10px;text-transform:uppercase;letter-spacing:1.5px;color:${accent};font-weight:600;border-bottom:1px solid #e5e7eb;width:100px;">Unit Price</th>
      <th style="padding:12px 8px;text-align:center;font-size:10px;text-transform:uppercase;letter-spacing:1.5px;color:${accent};font-weight:600;border-bottom:1px solid #e5e7eb;width:65px;">VAT</th>
      <th style="padding:12px 8px;text-align:right;font-size:10px;text-transform:uppercase;letter-spacing:1.5px;color:${accent};font-weight:600;border-bottom:1px solid #e5e7eb;width:100px;">Amount</th>
    </tr></thead>
    <tbody>${buildLineRows(q.line_items ?? [])}</tbody>
    <tfoot><tr><td colspan="5" style="padding:8px 0;"></td></tr>${buildTotalsRows(q)}</tfoot>
  </table>
</div>
<div style="padding:28px 50px 44px;">
  ${q.notes ? `<div style="font-size:12px;color:#888;white-space:pre-line;margin-bottom:12px;">${q.notes}</div>` : ''}
  ${q.expiry_date ? `<div style="margin-top:8px;padding-top:12px;border-top:1px solid #e5e7eb;font-size:12px;color:#888;">This quote is valid until <strong>${fmtDate(q.expiry_date)}</strong>.</div>` : ''}
</div>
<div style="border-top:1px solid #e5e7eb;padding:14px 50px;">
  <div style="font-size:11px;color:#ccc;text-align:center;">${[co.name, co.address_line1, co.phone].filter(Boolean).join(' &middot; ')}</div>
</div>
</body></html>`;
}

// ─── Main export ──────────────────────────────────────────────────────────────

export function buildQuoteHtml(quote: any, company: any): string {
  const template = (company.invoice_template ?? 'MODERN').toUpperCase();
  const accent   = company.invoice_accent_colour ?? '#1d4ed8';
  const showLogo = company.invoice_show_logo !== false;
  const logoSrc  = showLogo ? getLogoBase64(company.logo_url) : null;

  switch (template) {
    case 'CLASSIC': return buildClassic(quote, company, accent, logoSrc);
    case 'MINIMAL': return buildMinimal(quote, company, accent, logoSrc);
    default:        return buildModern (quote, company, accent, logoSrc);
  }
}
