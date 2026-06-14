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
      ext === 'webp'                  ? 'image/webp' : 'image/png';
    return `data:${mime};base64,${buf.toString('base64')}`;
  } catch { return null; }
}

const gbp = (pence: number) =>
  new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' })
    .format(pence / 100);

const fmtDate = (d: string | Date): string =>
  new Date(d as string).toLocaleDateString('en-GB', {
    day: '2-digit', month: 'long', year: 'numeric',
  });

const CIS_STATUS_LABELS: Record<string, string> = {
  GROSS:    'Gross Payment Status (0%)',
  STANDARD: 'Standard Rate (20%)',
  HIGHER:   'Higher Rate (30%) — Unverified',
};

export interface PdsData {
  contractor_name:     string;
  contractor_utr?:     string | null;
  contractor_address?: string | null;
  contractor_phone?:   string | null;
  logo_url?:           string | null;
  accent_colour?:      string | null;

  subcontractor_name: string;
  subcontractor_utr:  string | null;
  cis_status:         string;
  deduction_rate:     number;

  tax_month:       string;
  tax_month_label: string;
  period_start:    string;
  period_end:      string;
  issue_date:      Date;

  payments: {
    payment_date:           string;
    description:            string | null;
    invoice_ref:            string | null;
    gross_amount_pence:     number;
    labour_amount_pence:    number;
    materials_amount_pence: number;
    vat_amount_pence:       number;
    equipment_hire_pence:   number;
    deduction_amount_pence: number;
    net_payment_pence:      number;
  }[];

  total_gross_pence:     number;
  total_labour_pence:    number;
  total_materials_pence: number;
  total_deduction_pence: number;
  total_net_pence:       number;
}

export function buildPdsHtml(data: PdsData): string {
  const accent  = data.accent_colour ?? '#1d4ed8';
  const logoSrc = getLogoBase64(data.logo_url ?? null);

  const paymentRows = data.payments.map(p => `
    <tr style="border-bottom:1px solid #f0f0f0;">
      <td style="padding:8px 12px;font-size:12px;">${fmtDate(p.payment_date)}</td>
      <td style="padding:8px 12px;font-size:12px;">${p.invoice_ref ?? '—'}</td>
      <td style="padding:8px 12px;font-size:12px;">${p.description ?? '—'}</td>
      <td style="padding:8px 12px;font-size:12px;text-align:right;">${gbp(p.gross_amount_pence)}</td>
      <td style="padding:8px 12px;font-size:12px;text-align:right;">${gbp(p.materials_amount_pence)}</td>
      <td style="padding:8px 12px;font-size:12px;text-align:right;">${gbp(p.labour_amount_pence)}</td>
      <td style="padding:8px 12px;font-size:12px;text-align:right;color:#dc2626;font-weight:600;">
        -${gbp(p.deduction_amount_pence)}
      </td>
      <td style="padding:8px 12px;font-size:12px;text-align:right;font-weight:700;">
        ${gbp(p.net_payment_pence)}
      </td>
    </tr>
  `).join('');

  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>
  * { box-sizing:border-box; margin:0; padding:0; }
  body { font-family:Arial,Helvetica,sans-serif; color:#1a1a1a; font-size:13px;
    line-height:1.5; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  table { border-collapse:collapse; width:100%; }
  .section { margin:0 40px 24px; }
  .label { font-size:10px; font-weight:600; text-transform:uppercase;
    letter-spacing:1.5px; color:#aaa; margin-bottom:6px; }
  hr { border:none; border-top:1px solid #e5e7eb; margin:20px 40px; }
</style>
</head><body>

<!-- Header -->
<div style="background:${accent};padding:28px 40px;
  -webkit-print-color-adjust:exact;print-color-adjust:exact;">
  <table><tr>
    <td style="vertical-align:middle;">
      ${logoSrc ? `<img src="${logoSrc}" style="max-height:48px;max-width:150px;object-fit:contain;display:block;margin-bottom:8px;">` : ''}
      <div style="color:white;font-size:18px;font-weight:bold;">${data.contractor_name}</div>
      ${data.contractor_address ? `<div style="color:rgba(255,255,255,0.75);font-size:11px;margin-top:2px;">${data.contractor_address}</div>` : ''}
      ${data.contractor_phone   ? `<div style="color:rgba(255,255,255,0.75);font-size:11px;">${data.contractor_phone}</div>` : ''}
      ${data.contractor_utr     ? `<div style="color:rgba(255,255,255,0.75);font-size:11px;">Contractor UTR: ${data.contractor_utr}</div>` : ''}
    </td>
    <td style="text-align:right;vertical-align:top;">
      <div style="color:rgba(255,255,255,0.75);font-size:10px;text-transform:uppercase;
        letter-spacing:2px;margin-bottom:4px;">
        CIS Payment &amp; Deduction Statement
      </div>
      <div style="color:white;font-size:22px;font-weight:bold;">
        ${data.tax_month_label}
      </div>
      <div style="color:rgba(255,255,255,0.75);font-size:11px;margin-top:6px;">
        Issued: ${fmtDate(data.issue_date)}
      </div>
    </td>
  </tr></table>
</div>

<!-- Subcontractor + CIS details -->
<div style="padding:24px 40px 0;display:flex;gap:40px;">
  <div style="flex:1;">
    <div class="label">Subcontractor</div>
    <div style="font-size:16px;font-weight:bold;color:#111;">${data.subcontractor_name}</div>
    ${data.subcontractor_utr
      ? `<div style="font-size:12px;color:#555;margin-top:3px;">UTR: <strong>${data.subcontractor_utr}</strong></div>`
      : `<div style="font-size:12px;color:#dc2626;margin-top:3px;">&#9888; UTR not recorded</div>`
    }
  </div>
  <div style="flex:1;">
    <div class="label">CIS Status</div>
    <div style="font-size:13px;font-weight:600;">${CIS_STATUS_LABELS[data.cis_status] ?? data.cis_status}</div>
    <div style="font-size:12px;color:#555;margin-top:2px;">
      Deduction rate: <strong>${data.deduction_rate}%</strong> (applied to labour only)
    </div>
  </div>
  <div style="flex:1;">
    <div class="label">Tax Period</div>
    <div style="font-size:13px;font-weight:600;">${data.tax_month_label}</div>
    <div style="font-size:12px;color:#555;margin-top:2px;">
      ${fmtDate(data.period_start)} to ${fmtDate(data.period_end)}
    </div>
  </div>
</div>

<hr>

<!-- Payment breakdown table -->
<div class="section">
  <div class="label" style="margin-bottom:10px;">Payment Details</div>
  <table style="border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
    <thead>
      <tr style="background:${accent};color:white;
        -webkit-print-color-adjust:exact;print-color-adjust:exact;">
        <th style="padding:10px 12px;text-align:left;font-size:11px;">Date</th>
        <th style="padding:10px 12px;text-align:left;font-size:11px;">Ref</th>
        <th style="padding:10px 12px;text-align:left;font-size:11px;">Description</th>
        <th style="padding:10px 12px;text-align:right;font-size:11px;">Gross</th>
        <th style="padding:10px 12px;text-align:right;font-size:11px;">Materials</th>
        <th style="padding:10px 12px;text-align:right;font-size:11px;">Labour</th>
        <th style="padding:10px 12px;text-align:right;font-size:11px;">CIS Deducted</th>
        <th style="padding:10px 12px;text-align:right;font-size:11px;">Net Paid</th>
      </tr>
    </thead>
    <tbody>${paymentRows}</tbody>
    <tfoot style="border-top:2px solid #e5e7eb;background:#f9fafb;
      -webkit-print-color-adjust:exact;print-color-adjust:exact;">
      <tr>
        <td colspan="3" style="padding:12px;font-size:13px;font-weight:700;">TOTALS</td>
        <td style="padding:12px;text-align:right;font-size:13px;font-weight:700;">${gbp(data.total_gross_pence)}</td>
        <td style="padding:12px;text-align:right;font-size:13px;font-weight:700;">${gbp(data.total_materials_pence)}</td>
        <td style="padding:12px;text-align:right;font-size:13px;font-weight:700;">${gbp(data.total_labour_pence)}</td>
        <td style="padding:12px;text-align:right;font-size:13px;font-weight:700;color:#dc2626;">-${gbp(data.total_deduction_pence)}</td>
        <td style="padding:12px;text-align:right;font-size:15px;font-weight:700;">${gbp(data.total_net_pence)}</td>
      </tr>
    </tfoot>
  </table>
</div>

<hr>

<!-- CIS summary box -->
<div class="section">
  <div style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:10px;padding:20px;">
    <div class="label" style="color:#0369a1;margin-bottom:12px;">CIS Deduction Summary</div>
    <table style="width:auto;font-size:13px;">
      <tr>
        <td style="padding:4px 40px 4px 0;color:#555;">Gross amount paid</td>
        <td style="font-weight:600;">${gbp(data.total_gross_pence)}</td>
      </tr>
      <tr>
        <td style="padding:4px 40px 4px 0;color:#555;">Less: cost of materials</td>
        <td style="font-weight:600;">-${gbp(data.total_materials_pence)}</td>
      </tr>
      <tr style="border-top:1px solid #bae6fd;">
        <td style="padding:8px 40px 4px 0;color:#555;">Amount liable to CIS deduction</td>
        <td style="padding-top:8px;font-weight:600;">${gbp(data.total_labour_pence)}</td>
      </tr>
      <tr>
        <td style="padding:4px 40px 4px 0;color:#555;">CIS deduction at ${data.deduction_rate}%</td>
        <td style="font-weight:700;color:#dc2626;">-${gbp(data.total_deduction_pence)}</td>
      </tr>
      <tr style="border-top:2px solid #bae6fd;">
        <td style="padding:10px 40px 0 0;font-weight:700;font-size:14px;">Net payment to subcontractor</td>
        <td style="padding-top:10px;font-weight:700;font-size:16px;">${gbp(data.total_net_pence)}</td>
      </tr>
    </table>
  </div>
</div>

<!-- Legal footer -->
<div style="margin:24px 40px 0;padding:16px;background:#fafafa;
  border:1px solid #e5e7eb;border-radius:8px;">
  <p style="font-size:11px;color:#888;line-height:1.7;">
    This statement is issued under the Construction Industry Scheme (CIS) in accordance
    with the Income Tax (Construction Industry Scheme) Regulations 2005. The contractor
    has deducted the amount shown above and will pay it to HMRC on your behalf. You can
    use this statement to reconcile your CIS deductions when completing your Self Assessment
    tax return or Corporation Tax return. If you believe there is an error in this
    statement, please contact <strong>${data.contractor_name}</strong>
    ${data.contractor_phone ? `on ${data.contractor_phone}` : 'directly'}.
  </p>
</div>

<div style="border-top:1px solid #eee;padding:12px 40px;margin-top:20px;background:#fafafa;">
  <p style="font-size:10px;color:#bbb;text-align:center;">
    Produced by Vantro &middot; ${data.contractor_name}
    ${data.contractor_utr ? `&middot; Contractor UTR: ${data.contractor_utr}` : ''}
  </p>
</div>

</body></html>`;
}
