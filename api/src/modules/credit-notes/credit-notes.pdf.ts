// src/modules/credit-notes/credit-notes.pdf.ts
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
  } catch {
    return null;
  }
}

const gbp = (pence: number) =>
  new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(pence / 100);

const fmtDate = (d?: string | Date | null): string => {
  if (!d) return '—';
  return new Date(d as string).toLocaleDateString('en-GB', {
    day: '2-digit', month: 'long', year: 'numeric',
  });
};

function buildLineRows(items: any[]): string {
  if (!items?.length) {
    return `<tr><td colspan="4" style="padding:20px;text-align:center;color:#999;font-size:12px;">No line items</td></tr>`;
  }
  return items.map((it: any) => `<tr>
      <td style="padding:9px 12px;border-bottom:1px solid #f0f0f0;font-size:13px;">${it.description ?? ''}</td>
      <td style="padding:9px 12px;border-bottom:1px solid #f0f0f0;text-align:center;font-size:13px;">${it.quantity ?? 1}</td>
      <td style="padding:9px 12px;border-bottom:1px solid #f0f0f0;text-align:center;color:#666;font-size:11px;">${it.vat_rate ?? 0}%</td>
      <td style="padding:9px 12px;border-bottom:1px solid #f0f0f0;text-align:right;font-size:13px;">${gbp(it.net_pence ?? 0)}</td>
    </tr>`).join('');
}

const TABLE_HEADER_COLS = `
  <th style="padding:10px 12px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;font-weight:600;">Description</th>
  <th style="padding:10px 12px;text-align:center;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;font-weight:600;width:55px;">Qty</th>
  <th style="padding:10px 12px;text-align:center;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;font-weight:600;width:65px;">VAT</th>
  <th style="padding:10px 12px;text-align:right;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;font-weight:600;width:100px;">Amount</th>`;

// ─── Main export ──────────────────────────────────────────────────────────────
// Deliberately a single template (unlike invoices' three) — credit notes are
// an infrequent, functional document, not a brand showcase. Reuses the
// company's invoice accent colour and logo settings so it still looks
// consistent with the rest of the company's paperwork.

export function buildCreditNoteHtml(note: any, company: any): string {
  const accent = company.invoice_accent_colour ?? '#1d4ed8';
  const showLogo = company.invoice_show_logo !== false;
  const logoSrc = showLogo ? getLogoBase64(company.logo_url) : null;

  const coAddr = [company.address_line1, company.address_line2, company.city, company.postcode].filter(Boolean).join(', ');
  const custAddrLines = [
    note.customer?.address_line1, note.customer?.address_line2,
    note.customer?.city, note.customer?.postcode,
  ].filter(Boolean).join('<br>');

  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,Helvetica,sans-serif;color:#1a1a1a;background:white;font-size:13px;line-height:1.5;-webkit-print-color-adjust:exact;print-color-adjust:exact}</style>
</head><body>

<!-- ═══ HEADER ═══ -->
<div style="background:${accent};padding:36px 44px;-webkit-print-color-adjust:exact;print-color-adjust:exact;">
  <table style="width:100%;border-collapse:collapse;"><tr>
    <td style="vertical-align:middle;">
      ${logoSrc ? `<img src="${logoSrc}" alt="logo" style="max-height:56px;max-width:160px;object-fit:contain;display:block;margin-bottom:10px;">` : ''}
      <div style="color:white;font-size:22px;font-weight:bold;line-height:1.2;">${company.name ?? ''}</div>
      ${coAddr ? `<div style="color:rgba(255,255,255,0.8);font-size:11px;margin-top:4px;">${coAddr}</div>` : ''}
      ${company.phone ? `<div style="color:rgba(255,255,255,0.75);font-size:11px;">${company.phone}</div>` : ''}
      ${company.vat_registered && company.vat_number ? `<div style="color:rgba(255,255,255,0.7);font-size:11px;margin-top:2px;">VAT No: ${company.vat_number}</div>` : ''}
    </td>
    <td style="text-align:right;vertical-align:top;">
      <div style="color:white;font-size:36px;font-weight:bold;letter-spacing:-1px;line-height:1;">CREDIT NOTE</div>
      <div style="color:rgba(255,255,255,0.9);font-size:18px;margin-top:6px;font-weight:500;">${note.credit_note_number ?? ''}</div>
    </td>
  </tr></table>
</div>

<!-- ═══ BILL TO + DETAILS ═══ -->
<div style="padding:32px 44px 24px;">
  <table style="width:100%;border-collapse:collapse;"><tr>
    <td style="width:52%;vertical-align:top;padding-right:40px;">
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:1.5px;color:#aaa;margin-bottom:8px;font-weight:600;">Credit To</div>
      <div style="font-size:15px;font-weight:bold;color:#111;">${note.customer?.name ?? ''}</div>
      ${custAddrLines ? `<div style="color:#666;font-size:12px;margin-top:6px;line-height:1.7;">${custAddrLines}</div>` : ''}
      ${note.customer?.email ? `<div style="color:#666;font-size:12px;margin-top:4px;">${note.customer.email}</div>` : ''}
    </td>
    <td style="vertical-align:top;">
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:1.5px;color:#aaa;margin-bottom:8px;font-weight:600;">Details</div>
      <table style="border-collapse:collapse;font-size:12px;">
        <tr><td style="color:#999;padding:3px 20px 3px 0;white-space:nowrap;">Date</td><td style="font-weight:600;color:#222;">${fmtDate(note.date)}</td></tr>
        ${note.invoice ? `<tr><td style="color:#999;padding:3px 20px 3px 0;">Against Invoice</td><td style="font-weight:600;">${note.invoice.invoice_number}</td></tr>` : ''}
        <tr><td style="color:#999;padding:3px 20px 3px 0;">Status</td><td style="font-weight:600;">${note.status}</td></tr>
      </table>
    </td>
  </tr></table>
</div>

<!-- ═══ REASON ═══ -->
<div style="padding:0 44px 20px;">
  <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:6px;padding:12px 16px;">
    <div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#c2410c;margin-bottom:4px;font-weight:600;">Reason for credit</div>
    <div style="font-size:13px;color:#7c2d12;">${note.reason ?? ''}</div>
  </div>
</div>

<!-- ═══ LINE ITEMS ═══ -->
<div style="padding:0 44px;">
  <table style="width:100%;border-collapse:collapse;">
    <thead><tr style="background:${accent};-webkit-print-color-adjust:exact;print-color-adjust:exact;">
      ${TABLE_HEADER_COLS.replace(/;font-size:11px/g, ';color:white;font-size:11px')}
    </tr></thead>
    <tbody>${buildLineRows(note.line_items ?? [])}</tbody>
    <tfoot>
      <tr><td colspan="4" style="padding:8px 0;"></td></tr>
      <tr>
        <td colspan="3" style="padding:6px 12px;text-align:right;color:#666;font-size:12px;">Subtotal</td>
        <td style="padding:6px 12px;text-align:right;font-size:12px;">${gbp(note.subtotal_pence ?? 0)}</td>
      </tr>
      <tr>
        <td colspan="3" style="padding:6px 12px;text-align:right;color:#666;font-size:12px;">VAT</td>
        <td style="padding:6px 12px;text-align:right;font-size:12px;">${gbp(note.vat_amount_pence ?? 0)}</td>
      </tr>
      <tr>
        <td colspan="3" style="padding:10px 12px;text-align:right;font-weight:bold;font-size:15px;border-top:2px solid #e5e5e5;">Total Credit</td>
        <td style="padding:10px 12px;text-align:right;font-weight:bold;font-size:15px;border-top:2px solid #e5e5e5;color:#dc2626;">&minus;${gbp(note.total_pence ?? 0)}</td>
      </tr>
    </tfoot>
  </table>
</div>

<!-- ═══ NOTES ═══ -->
<div style="padding:24px 44px 40px;">
  ${note.notes ? `<div><div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#aaa;margin-bottom:6px;font-weight:600;">Notes</div><div style="font-size:12px;color:#555;white-space:pre-line;line-height:1.6;">${note.notes}</div></div>` : ''}
</div>

<!-- ═══ FOOTER ═══ -->
<div style="border-top:1px solid #eee;padding:14px 44px;background:#fafafa;-webkit-print-color-adjust:exact;print-color-adjust:exact;">
  <div style="font-size:11px;color:#bbb;text-align:center;">
    ${[company.name, company.address_line1, company.postcode, company.phone, company.vat_registered && company.vat_number ? `VAT: ${company.vat_number}` : null].filter(Boolean).join(' &middot; ')}
  </div>
</div>

</body></html>`;
}
