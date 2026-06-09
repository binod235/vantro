// src/modules/invoices/invoice.pdf.ts
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
    return `<tr><td colspan="5" style="padding:20px;text-align:center;color:#999;font-size:12px;">No line items</td></tr>`;
  }
  return items.map((it: any) => {
    const vatLabel =
      it.vat_type === 'STANDARD'        ? `${it.vat_rate ?? 20}%` :
      it.vat_type === 'REVERSE_CHARGE'  ? 'RC' :
      it.vat_type === 'EXEMPT'          ? 'Exempt' : 'Zero';
    return `<tr>
      <td style="padding:9px 12px;border-bottom:1px solid #f0f0f0;font-size:13px;">${it.description ?? ''}</td>
      <td style="padding:9px 12px;border-bottom:1px solid #f0f0f0;text-align:center;font-size:13px;">${it.quantity ?? 1}</td>
      <td style="padding:9px 12px;border-bottom:1px solid #f0f0f0;text-align:right;font-size:13px;">${gbp(it.unit_price_pence ?? 0)}</td>
      <td style="padding:9px 12px;border-bottom:1px solid #f0f0f0;text-align:center;color:#666;font-size:11px;">${vatLabel}</td>
      <td style="padding:9px 12px;border-bottom:1px solid #f0f0f0;text-align:right;font-size:13px;">${gbp(it.net_pence ?? 0)}</td>
    </tr>`;
  }).join('');
}

function buildTotalsRows(inv: any): string {
  let html = `
    <tr>
      <td colspan="4" style="padding:6px 12px;text-align:right;color:#666;font-size:12px;">Subtotal</td>
      <td style="padding:6px 12px;text-align:right;font-size:12px;">${gbp(inv.subtotal_pence ?? 0)}</td>
    </tr>
    <tr>
      <td colspan="4" style="padding:6px 12px;text-align:right;color:#666;font-size:12px;">VAT</td>
      <td style="padding:6px 12px;text-align:right;font-size:12px;">${gbp(inv.vat_amount_pence ?? 0)}</td>
    </tr>`;
  if (inv.is_reverse_charge && (inv.reverse_charge_vat_pence ?? 0) > 0) {
    html += `<tr>
      <td colspan="4" style="padding:6px 12px;text-align:right;color:#b45309;font-size:12px;">Reverse Charge VAT (not payable)</td>
      <td style="padding:6px 12px;text-align:right;color:#b45309;font-size:12px;">${gbp(inv.reverse_charge_vat_pence)}</td>
    </tr>`;
  }
  html += `<tr>
    <td colspan="4" style="padding:10px 12px;text-align:right;font-weight:bold;font-size:15px;border-top:2px solid #e5e5e5;">Total</td>
    <td style="padding:10px 12px;text-align:right;font-weight:bold;font-size:15px;border-top:2px solid #e5e5e5;">${gbp(inv.total_pence ?? 0)}</td>
  </tr>`;
  if ((inv.amount_paid_pence ?? 0) > 0) {
    html += `
    <tr>
      <td colspan="4" style="padding:6px 12px;text-align:right;color:#16a34a;font-size:12px;">Amount Paid</td>
      <td style="padding:6px 12px;text-align:right;color:#16a34a;font-size:12px;">&minus;${gbp(inv.amount_paid_pence)}</td>
    </tr>
    <tr>
      <td colspan="4" style="padding:10px 12px;text-align:right;font-weight:bold;font-size:15px;color:#dc2626;">Amount Due</td>
      <td style="padding:10px 12px;text-align:right;font-weight:bold;font-size:15px;color:#dc2626;">${gbp(inv.amount_due_pence ?? 0)}</td>
    </tr>`;
  }
  return html;
}

function buildBankBox(company: any, style: 'card' | 'plain'): string {
  if (!company.bank_account_number) return '';
  const rows = [
    company.bank_name         ? `Bank: <strong>${company.bank_name}</strong>` : null,
    company.bank_account_name ? `Account Name: <strong>${company.bank_account_name}</strong>` : null,
    company.bank_sort_code    ? `Sort Code: <strong>${company.bank_sort_code}</strong>` : null,
    company.bank_account_number ? `Account Number: <strong>${company.bank_account_number}</strong>` : null,
  ].filter(Boolean);

  if (!rows.length) return '';
  const rowsHtml = rows.map(r => `<div style="font-size:12px;color:#444;margin-bottom:3px;">${r}</div>`).join('');

  if (style === 'card') {
    return `<div style="background:#f8f9fa;border:1px solid #e5e7eb;border-radius:6px;padding:16px;margin-top:16px;">
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#999;margin-bottom:8px;font-weight:600;">Payment Details</div>
      ${rowsHtml}
    </div>`;
  }
  return `<div style="margin-top:16px;padding-top:16px;border-top:1px solid #e5e7eb;">
    <div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#999;margin-bottom:6px;font-weight:600;">Payment Details</div>
    ${rowsHtml}
  </div>`;
}

function buildRcWarning(inv: any): string {
  if (!inv.is_reverse_charge) return '';
  return `<div style="background:#fffbeb;border:1px solid #fcd34d;border-radius:6px;padding:12px 16px;margin-top:16px;">
    <div style="font-size:12px;color:#92400e;font-weight:500;">&#9888; ${inv.reverse_charge_wording ?? 'Reverse charge: customer to account for VAT to HMRC.'}</div>
  </div>`;
}

const TABLE_HEADER_COLS = `
  <th style="padding:10px 12px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;font-weight:600;">Description</th>
  <th style="padding:10px 12px;text-align:center;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;font-weight:600;width:55px;">Qty</th>
  <th style="padding:10px 12px;text-align:right;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;font-weight:600;width:100px;">Unit Price</th>
  <th style="padding:10px 12px;text-align:center;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;font-weight:600;width:65px;">VAT</th>
  <th style="padding:10px 12px;text-align:right;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;font-weight:600;width:100px;">Amount</th>`;

// ─── MODERN TEMPLATE ──────────────────────────────────────────────────────────

function buildModern(inv: any, co: any, accent: string, logoSrc: string | null, opts: Record<string, boolean>): string {
  const { showLogo, showReference, showSiteAddress, showPaymentInfo } = opts;

  const coAddr = [co.address_line1, co.address_line2, co.city, co.postcode].filter(Boolean).join(', ');
  const custAddrLines = [
    inv.customer?.address_line1, inv.customer?.address_line2,
    inv.customer?.city, inv.customer?.postcode,
  ].filter(Boolean).join('<br>');

  const siteAddrText = showSiteAddress && inv.notes?.match(/Site Address: (.+)/)?.[1];

  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,Helvetica,sans-serif;color:#1a1a1a;background:white;font-size:13px;line-height:1.5;-webkit-print-color-adjust:exact;print-color-adjust:exact}</style>
</head><body>

<!-- ═══ HEADER ═══ -->
<div style="background:${accent};padding:36px 44px;-webkit-print-color-adjust:exact;print-color-adjust:exact;">
  <table style="width:100%;border-collapse:collapse;"><tr>
    <td style="vertical-align:middle;">
      ${showLogo && logoSrc ? `<img src="${logoSrc}" alt="logo" style="max-height:56px;max-width:160px;object-fit:contain;display:block;margin-bottom:10px;">` : ''}
      <div style="color:white;font-size:22px;font-weight:bold;line-height:1.2;">${co.name ?? ''}</div>
      ${coAddr ? `<div style="color:rgba(255,255,255,0.8);font-size:11px;margin-top:4px;">${coAddr}</div>` : ''}
      ${co.phone ? `<div style="color:rgba(255,255,255,0.75);font-size:11px;">${co.phone}</div>` : ''}
      ${co.website ? `<div style="color:rgba(255,255,255,0.75);font-size:11px;">${co.website}</div>` : ''}
      ${co.vat_registered && co.vat_number ? `<div style="color:rgba(255,255,255,0.7);font-size:11px;margin-top:2px;">VAT No: ${co.vat_number}</div>` : ''}
    </td>
    <td style="text-align:right;vertical-align:top;">
      <div style="color:white;font-size:40px;font-weight:bold;letter-spacing:-1px;line-height:1;">INVOICE</div>
      <div style="color:rgba(255,255,255,0.9);font-size:18px;margin-top:6px;font-weight:500;">${inv.invoice_number ?? ''}</div>
      ${inv.invoice_type && inv.invoice_type !== 'STANDARD' ? `<div style="color:rgba(255,255,255,0.7);font-size:11px;margin-top:4px;text-transform:uppercase;letter-spacing:1px;">${inv.invoice_type}</div>` : ''}
    </td>
  </tr></table>
</div>

<!-- ═══ BILL TO + DETAILS ═══ -->
<div style="padding:32px 44px 24px;">
  <table style="width:100%;border-collapse:collapse;"><tr>
    <td style="width:52%;vertical-align:top;padding-right:40px;">
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:1.5px;color:#aaa;margin-bottom:8px;font-weight:600;">Bill To</div>
      <div style="font-size:15px;font-weight:bold;color:#111;">${inv.customer?.name ?? ''}</div>
      ${custAddrLines ? `<div style="color:#666;font-size:12px;margin-top:6px;line-height:1.7;">${custAddrLines}</div>` : ''}
      ${inv.customer?.email ? `<div style="color:#666;font-size:12px;margin-top:4px;">${inv.customer.email}</div>` : ''}
      ${inv.customer?.phone ? `<div style="color:#666;font-size:12px;">${inv.customer.phone}</div>` : ''}
      ${siteAddrText ? `<div style="margin-top:10px;"><div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#aaa;margin-bottom:4px;font-weight:600;">Site Address</div><div style="font-size:12px;color:#555;">${siteAddrText}</div></div>` : ''}
    </td>
    <td style="vertical-align:top;">
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:1.5px;color:#aaa;margin-bottom:8px;font-weight:600;">Invoice Details</div>
      <table style="border-collapse:collapse;font-size:12px;">
        <tr><td style="color:#999;padding:3px 20px 3px 0;white-space:nowrap;">Issue Date</td><td style="font-weight:600;color:#222;">${fmtDate(inv.issue_date)}</td></tr>
        <tr><td style="color:#999;padding:3px 20px 3px 0;">Due Date</td><td style="font-weight:600;color:#222;">${fmtDate(inv.due_date)}</td></tr>
        ${showReference && inv.notes?.match(/Reference: (.+)/)?.[1] ? `<tr><td style="color:#999;padding:3px 20px 3px 0;">Reference</td><td style="font-weight:600;">${inv.notes.match(/Reference: (.+)/)[1]}</td></tr>` : ''}
        ${inv.job ? `<tr><td style="color:#999;padding:3px 20px 3px 0;">Job</td><td style="font-weight:600;">${inv.job.title}</td></tr>` : ''}
        ${inv.quote ? `<tr><td style="color:#999;padding:3px 20px 3px 0;">Quote</td><td style="font-weight:600;">${inv.quote.quote_number}</td></tr>` : ''}
        ${inv.status === 'PAID' ? `<tr><td style="color:#999;padding:3px 20px 3px 0;">Status</td><td style="color:#16a34a;font-weight:bold;">PAID</td></tr>` : ''}
      </table>
    </td>
  </tr></table>
</div>

<!-- ═══ LINE ITEMS ═══ -->
<div style="padding:0 44px;">
  <table style="width:100%;border-collapse:collapse;">
    <thead><tr style="background:${accent};-webkit-print-color-adjust:exact;print-color-adjust:exact;">
      ${TABLE_HEADER_COLS.replace(/;font-size:11px/g, ';color:white;font-size:11px')}
    </tr></thead>
    <tbody>${buildLineRows(inv.line_items ?? [])}</tbody>
    <tfoot>
      <tr><td colspan="5" style="padding:8px 0;"></td></tr>
      ${buildTotalsRows(inv)}
    </tfoot>
  </table>
</div>

<!-- ═══ NOTES / RC / BANK ═══ -->
<div style="padding:24px 44px 40px;">
  ${inv.notes ? `<div style="margin-bottom:16px;"><div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#aaa;margin-bottom:6px;font-weight:600;">Notes</div><div style="font-size:12px;color:#555;white-space:pre-line;line-height:1.6;">${inv.notes}</div></div>` : ''}
  ${buildRcWarning(inv)}
  ${showPaymentInfo ? buildBankBox(co, 'card') : ''}
</div>

<!-- ═══ FOOTER ═══ -->
<div style="border-top:1px solid #eee;padding:14px 44px;background:#fafafa;-webkit-print-color-adjust:exact;print-color-adjust:exact;">
  <div style="font-size:11px;color:#bbb;text-align:center;">
    ${[co.name, co.address_line1, co.postcode, co.phone, co.website, co.vat_registered && co.vat_number ? `VAT: ${co.vat_number}` : null].filter(Boolean).join(' &middot; ')}
  </div>
</div>

</body></html>`;
}

// ─── CLASSIC TEMPLATE ─────────────────────────────────────────────────────────

function buildClassic(inv: any, co: any, accent: string, logoSrc: string | null, opts: Record<string, boolean>): string {
  const { showLogo, showReference, showSiteAddress, showPaymentInfo } = opts;

  const coAddr = [co.address_line1, co.address_line2, co.city, co.county, co.postcode].filter(Boolean);
  const custAddr = [inv.customer?.address_line1, inv.customer?.address_line2, inv.customer?.city, inv.customer?.postcode].filter(Boolean);
  const siteAddrText = showSiteAddress && inv.notes?.match(/Site Address: (.+)/)?.[1];

  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,Helvetica,sans-serif;color:#1a1a1a;background:white;font-size:13px;line-height:1.5;-webkit-print-color-adjust:exact;print-color-adjust:exact}</style>
</head><body>

<!-- ═══ HEADER ═══ -->
<div style="padding:40px 44px 0;">
  <table style="width:100%;border-collapse:collapse;"><tr>
    <td style="vertical-align:top;width:50%;">
      ${showLogo && logoSrc ? `<img src="${logoSrc}" alt="logo" style="max-height:64px;max-width:180px;object-fit:contain;display:block;margin-bottom:12px;">` : ''}
      <div style="font-size:18px;font-weight:bold;color:#111;">${co.name ?? ''}</div>
      ${coAddr.map(l => `<div style="font-size:12px;color:#666;line-height:1.7;">${l}</div>`).join('')}
      ${co.phone ? `<div style="font-size:12px;color:#666;">${co.phone}</div>` : ''}
      ${co.website ? `<div style="font-size:12px;color:#666;">${co.website}</div>` : ''}
      ${co.vat_registered && co.vat_number ? `<div style="font-size:12px;color:#666;">VAT No: ${co.vat_number}</div>` : ''}
    </td>
    <td style="text-align:right;vertical-align:top;">
      <div style="font-size:42px;font-weight:bold;color:${accent};letter-spacing:-2px;line-height:1;">INVOICE</div>
      <div style="font-size:14px;color:#555;margin-top:6px;font-weight:500;">${inv.invoice_number ?? ''}</div>
      ${inv.invoice_type && inv.invoice_type !== 'STANDARD' ? `<div style="font-size:11px;color:#999;margin-top:3px;text-transform:uppercase;">${inv.invoice_type}</div>` : ''}
    </td>
  </tr></table>
</div>

<!-- ═══ DIVIDER ═══ -->
<div style="margin:24px 44px 0;border-top:2px solid ${accent};-webkit-print-color-adjust:exact;print-color-adjust:exact;"></div>

<!-- ═══ META BAR ═══ -->
<div style="background:#f8f9fa;padding:12px 44px;-webkit-print-color-adjust:exact;print-color-adjust:exact;">
  <table style="width:100%;border-collapse:collapse;font-size:12px;"><tr>
    <td style="width:25%;"><span style="color:#999;">Issue Date</span><br><strong>${fmtDate(inv.issue_date)}</strong></td>
    <td style="width:25%;"><span style="color:#999;">Due Date</span><br><strong>${fmtDate(inv.due_date)}</strong></td>
    ${showReference && inv.notes?.match(/Reference: (.+)/)?.[1] ? `<td style="width:25%;"><span style="color:#999;">Reference</span><br><strong>${inv.notes.match(/Reference: (.+)/)[1]}</strong></td>` : '<td></td>'}
    <td style="text-align:right;">
      ${inv.status === 'PAID' ? `<span style="background:#dcfce7;color:#16a34a;padding:4px 12px;border-radius:20px;font-size:11px;font-weight:bold;text-transform:uppercase;">Paid</span>` : `<span style="background:#fee2e2;color:#dc2626;padding:4px 12px;border-radius:20px;font-size:11px;font-weight:bold;text-transform:uppercase;">Due ${fmtDate(inv.due_date)}</span>`}
    </td>
  </tr></table>
</div>

<!-- ═══ BILL TO ═══ -->
<div style="padding:28px 44px 24px;">
  <table style="width:100%;border-collapse:collapse;"><tr>
    <td style="width:45%;vertical-align:top;padding-right:40px;">
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#aaa;margin-bottom:8px;font-weight:600;">Bill To</div>
      <div style="font-size:14px;font-weight:bold;color:#111;">${inv.customer?.name ?? ''}</div>
      ${custAddr.map(l => `<div style="font-size:12px;color:#666;line-height:1.7;">${l}</div>`).join('')}
      ${inv.customer?.email ? `<div style="font-size:12px;color:#666;">${inv.customer.email}</div>` : ''}
      ${inv.customer?.phone ? `<div style="font-size:12px;color:#666;">${inv.customer.phone}</div>` : ''}
    </td>
    ${siteAddrText ? `<td style="vertical-align:top;">
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#aaa;margin-bottom:8px;font-weight:600;">Site Address</div>
      <div style="font-size:12px;color:#666;">${siteAddrText}</div>
    </td>` : '<td></td>'}
  </tr></table>
</div>

<!-- ═══ LINE ITEMS ═══ -->
<div style="padding:0 44px;">
  <table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;">
    <thead><tr style="background:${accent};-webkit-print-color-adjust:exact;print-color-adjust:exact;">
      ${TABLE_HEADER_COLS.replace(/;font-size:11px/g, ';color:white;font-size:11px')}
    </tr></thead>
    <tbody>${buildLineRows(inv.line_items ?? [])}</tbody>
    <tfoot>
      <tr><td colspan="5" style="padding:8px 0;"></td></tr>
      ${buildTotalsRows(inv)}
    </tfoot>
  </table>
</div>

<!-- ═══ NOTES / RC / BANK ═══ -->
<div style="padding:24px 44px 40px;">
  ${inv.notes ? `<div style="margin-bottom:16px;"><div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#aaa;margin-bottom:6px;font-weight:600;">Notes</div><div style="font-size:12px;color:#555;white-space:pre-line;line-height:1.6;">${inv.notes}</div></div>` : ''}
  ${buildRcWarning(inv)}
  ${showPaymentInfo ? buildBankBox(co, 'card') : ''}
</div>

<!-- ═══ FOOTER ═══ -->
<div style="border-top:2px solid ${accent};padding:14px 44px;-webkit-print-color-adjust:exact;print-color-adjust:exact;">
  <div style="font-size:11px;color:#999;text-align:center;">
    ${[co.name, co.address_line1, co.postcode, co.phone, co.vat_registered && co.vat_number ? `VAT: ${co.vat_number}` : null].filter(Boolean).join(' &middot; ')}
  </div>
</div>

</body></html>`;
}

// ─── MINIMAL TEMPLATE ─────────────────────────────────────────────────────────

function buildMinimal(inv: any, co: any, accent: string, logoSrc: string | null, opts: Record<string, boolean>): string {
  const { showLogo, showReference, showSiteAddress, showPaymentInfo } = opts;

  const coAddr = [co.address_line1, co.address_line2, co.city, co.postcode].filter(Boolean).join(', ');
  const custAddr = [inv.customer?.address_line1, inv.customer?.address_line2, inv.customer?.city, inv.customer?.postcode].filter(Boolean).join(', ');
  const siteAddrText = showSiteAddress && inv.notes?.match(/Site Address: (.+)/)?.[1];
  const refText = showReference && inv.notes?.match(/Reference: (.+)/)?.[1];

  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,Helvetica,sans-serif;color:#1a1a1a;background:white;font-size:13px;line-height:1.5;-webkit-print-color-adjust:exact;print-color-adjust:exact}</style>
</head><body>

<!-- ═══ HEADER ═══ -->
<div style="padding:44px 50px 28px;">
  <table style="width:100%;border-collapse:collapse;"><tr>
    <td style="vertical-align:top;">
      ${showLogo && logoSrc ? `<img src="${logoSrc}" alt="logo" style="max-height:52px;max-width:160px;object-fit:contain;display:block;margin-bottom:10px;">` : ''}
      <div style="font-size:18px;font-weight:bold;color:#111;">${co.name ?? ''}</div>
      ${coAddr ? `<div style="font-size:11px;color:#999;margin-top:3px;">${coAddr}</div>` : ''}
      ${co.phone ? `<div style="font-size:11px;color:#999;">${co.phone}</div>` : ''}
      ${co.vat_registered && co.vat_number ? `<div style="font-size:11px;color:#999;">VAT: ${co.vat_number}</div>` : ''}
    </td>
    <td style="text-align:right;vertical-align:top;">
      <div style="font-size:11px;text-transform:uppercase;letter-spacing:2px;color:${accent};font-weight:600;margin-bottom:6px;">Invoice</div>
      <div style="font-size:28px;font-weight:bold;color:#111;letter-spacing:-0.5px;">${inv.invoice_number ?? ''}</div>
    </td>
  </tr></table>
</div>

<!-- ═══ RULE ═══ -->
<div style="margin:0 50px;border-top:1px solid #e5e7eb;"></div>

<!-- ═══ BILL TO + META ═══ -->
<div style="padding:28px 50px;">
  <table style="width:100%;border-collapse:collapse;"><tr>
    <td style="width:40%;vertical-align:top;padding-right:40px;">
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:1.5px;color:#ccc;margin-bottom:8px;font-weight:600;">Bill To</div>
      <div style="font-size:14px;font-weight:bold;">${inv.customer?.name ?? ''}</div>
      ${custAddr ? `<div style="font-size:12px;color:#888;margin-top:4px;">${custAddr}</div>` : ''}
      ${inv.customer?.email ? `<div style="font-size:12px;color:#888;">${inv.customer.email}</div>` : ''}
      ${siteAddrText ? `<div style="margin-top:10px;"><div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#ccc;margin-bottom:4px;font-weight:600;">Site</div><div style="font-size:12px;color:#888;">${siteAddrText}</div></div>` : ''}
    </td>
    <td style="vertical-align:top;">
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:1.5px;color:#ccc;margin-bottom:8px;font-weight:600;">Details</div>
      <table style="border-collapse:collapse;font-size:12px;">
        <tr><td style="color:#bbb;padding:3px 20px 3px 0;white-space:nowrap;">Issue Date</td><td style="color:#333;">${fmtDate(inv.issue_date)}</td></tr>
        <tr><td style="color:#bbb;padding:3px 20px 3px 0;">Due Date</td><td style="color:#333;">${fmtDate(inv.due_date)}</td></tr>
        ${refText ? `<tr><td style="color:#bbb;padding:3px 20px 3px 0;">Reference</td><td style="color:#333;">${refText}</td></tr>` : ''}
        ${inv.job ? `<tr><td style="color:#bbb;padding:3px 20px 3px 0;">Job</td><td style="color:#333;">${inv.job.title}</td></tr>` : ''}
        ${inv.status === 'PAID' ? `<tr><td style="color:#bbb;padding:3px 20px 3px 0;">Status</td><td style="color:#16a34a;font-weight:600;">Paid</td></tr>` : ''}
      </table>
    </td>
  </tr></table>
</div>

<!-- ═══ RULE ═══ -->
<div style="margin:0 50px;border-top:1px solid #e5e7eb;"></div>

<!-- ═══ LINE ITEMS ═══ -->
<div style="padding:0 50px;">
  <table style="width:100%;border-collapse:collapse;">
    <thead><tr>
      <th style="padding:12px 8px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:1.5px;color:${accent};font-weight:600;border-bottom:1px solid #e5e7eb;">Description</th>
      <th style="padding:12px 8px;text-align:center;font-size:10px;text-transform:uppercase;letter-spacing:1.5px;color:${accent};font-weight:600;border-bottom:1px solid #e5e7eb;width:55px;">Qty</th>
      <th style="padding:12px 8px;text-align:right;font-size:10px;text-transform:uppercase;letter-spacing:1.5px;color:${accent};font-weight:600;border-bottom:1px solid #e5e7eb;width:100px;">Unit Price</th>
      <th style="padding:12px 8px;text-align:center;font-size:10px;text-transform:uppercase;letter-spacing:1.5px;color:${accent};font-weight:600;border-bottom:1px solid #e5e7eb;width:65px;">VAT</th>
      <th style="padding:12px 8px;text-align:right;font-size:10px;text-transform:uppercase;letter-spacing:1.5px;color:${accent};font-weight:600;border-bottom:1px solid #e5e7eb;width:100px;">Amount</th>
    </tr></thead>
    <tbody>${buildLineRows(inv.line_items ?? [])}</tbody>
    <tfoot>
      <tr><td colspan="5" style="padding:8px 0;"></td></tr>
      ${buildTotalsRows(inv)}
    </tfoot>
  </table>
</div>

<!-- ═══ NOTES / RC / BANK ═══ -->
<div style="padding:28px 50px 44px;">
  ${inv.notes ? `<div style="margin-bottom:16px;"><div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#ccc;margin-bottom:6px;font-weight:600;">Notes</div><div style="font-size:12px;color:#888;white-space:pre-line;line-height:1.6;">${inv.notes}</div></div>` : ''}
  ${buildRcWarning(inv)}
  ${showPaymentInfo ? buildBankBox(co, 'plain') : ''}
</div>

<!-- ═══ FOOTER ═══ -->
<div style="border-top:1px solid #e5e7eb;padding:14px 50px;">
  <div style="font-size:11px;color:#ccc;text-align:center;">
    ${[co.name, co.address_line1, co.postcode, co.phone, co.vat_registered && co.vat_number ? `VAT: ${co.vat_number}` : null].filter(Boolean).join(' &middot; ')}
  </div>
</div>

</body></html>`;
}

// ─── Main export ──────────────────────────────────────────────────────────────

export function buildInvoiceHtml(invoice: any, company: any): string {
  const template  = (company.invoice_template  ?? 'MODERN').toUpperCase();
  const accent    = company.invoice_accent_colour ?? '#1d4ed8';
  const showLogo         = company.invoice_show_logo         !== false;
  const showReference    = company.invoice_show_reference    !== false;
  const showSiteAddress  = company.invoice_show_site_address !== false;
  const showPaymentInfo  = company.invoice_show_payment_info !== false;

  const logoSrc = showLogo ? getLogoBase64(company.logo_url) : null;

  const opts = { showLogo, showReference, showSiteAddress, showPaymentInfo };

  switch (template) {
    case 'CLASSIC': return buildClassic(invoice, company, accent, logoSrc, opts);
    case 'MINIMAL': return buildMinimal(invoice, company, accent, logoSrc, opts);
    default:        return buildModern (invoice, company, accent, logoSrc, opts);
  }
}