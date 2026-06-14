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

export interface Cis300Data {
  contractor_name:         string;
  contractor_utr:          string | null;
  accounts_office_ref:     string | null;
  contractor_address:      string | null;
  logo_url:                string | null;
  accent_colour:           string | null;

  tax_month:               string;
  tax_month_label:         string;
  period_start:            string;
  period_end:              string;
  deadline:                string;
  generated_at:            Date;

  subcontractors: {
    name:                   string;
    utr_number:             string | null;
    verification_number:    string | null;
    cis_status:             string;
    deduction_rate:         number;
    gross_amount_pence:     number;
    materials_amount_pence: number;
    labour_amount_pence:    number;
    deduction_amount_pence: number;
  }[];

  total_gross_pence:      number;
  total_materials_pence:  number;
  total_labour_pence:     number;
  total_deductions_pence: number;

  total_suffered_pence:   number;
  net_liability_pence:    number;

  is_nil_return:          boolean;
  is_repayment:           boolean;
}

export function buildCis300Html(data: Cis300Data): string {
  const accent  = data.accent_colour ?? '#1d4ed8';
  const logoSrc = getLogoBase64(data.logo_url);

  const gbp = (p: number) =>
    new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(p / 100);

  const fmtDate = (d: string | Date) =>
    new Date(d as string).toLocaleDateString('en-GB', {
      day: '2-digit', month: 'long', year: 'numeric',
    });

  const subRows = data.subcontractors.map((s, i) => `
    <tr style="${i % 2 !== 0 ? 'background:#f9fafb;' : ''}border-bottom:1px solid #f0f0f0;">
      <td style="padding:8px 10px;font-size:12px;font-weight:600;">${s.name}</td>
      <td style="padding:8px 10px;font-size:12px;font-family:monospace;">
        ${s.utr_number ?? '<span style="color:#dc2626;font-weight:600;">MISSING</span>'}
      </td>
      <td style="padding:8px 10px;font-size:11px;color:#555;">${s.verification_number ?? '—'}</td>
      <td style="padding:8px 10px;font-size:11px;text-align:center;">
        <span style="
          background:${s.cis_status === 'GROSS' ? '#dcfce7' : s.cis_status === 'STANDARD' ? '#dbeafe' : '#fef3c7'};
          color:${s.cis_status === 'GROSS' ? '#16a34a' : s.cis_status === 'STANDARD' ? '#1d4ed8' : '#d97706'};
          padding:2px 8px;border-radius:10px;font-size:10px;font-weight:600;">
          ${s.deduction_rate}%
        </span>
      </td>
      <td style="padding:8px 10px;font-size:12px;text-align:right;">${gbp(s.gross_amount_pence)}</td>
      <td style="padding:8px 10px;font-size:12px;text-align:right;">${gbp(s.materials_amount_pence)}</td>
      <td style="padding:8px 10px;font-size:12px;text-align:right;">${gbp(s.labour_amount_pence)}</td>
      <td style="padding:8px 10px;font-size:12px;text-align:right;font-weight:700;color:#dc2626;">
        ${gbp(s.deduction_amount_pence)}
      </td>
    </tr>
  `).join('');

  const nilBanner = data.is_nil_return ? `
    <div style="background:#f1f5f9;border:1px solid #cbd5e1;border-radius:8px;
      padding:16px 20px;margin:24px 40px;text-align:center;">
      <p style="font-size:14px;font-weight:600;color:#475569;">NIL RETURN</p>
      <p style="font-size:12px;color:#64748b;margin-top:4px;">
        No subcontractors were paid in this period.
        A nil return must still be submitted to HMRC by ${fmtDate(data.deadline)}.
      </p>
    </div>` : '';

  const sufferedCards = data.total_suffered_pence > 0 ? `
    <div style="flex:1;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:16px;">
      <div style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:1.5px;color:#16a34a;margin-bottom:6px;">CIS suffered (offset)</div>
      <div style="font-size:24px;font-weight:bold;color:#16a34a;">-${gbp(data.total_suffered_pence)}</div>
      <div style="font-size:11px;color:#888;margin-top:3px;">CIS deducted from your own payments</div>
    </div>
    <div style="flex:1;background:${data.is_repayment ? '#f0fdf4' : '#eff6ff'};
      border:1px solid ${data.is_repayment ? '#bbf7d0' : '#bfdbfe'};border-radius:8px;padding:16px;">
      <div style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:1.5px;color:${data.is_repayment ? '#16a34a' : '#1d4ed8'};margin-bottom:6px;">
        ${data.is_repayment ? 'Net repayment due' : 'Net CIS liability'}
      </div>
      <div style="font-size:24px;font-weight:bold;color:${data.is_repayment ? '#16a34a' : '#1d4ed8'};">
        ${gbp(Math.abs(data.net_liability_pence))}
      </div>
      <div style="font-size:11px;color:#888;margin-top:3px;">
        ${data.is_repayment ? 'Claim this back from HMRC' : 'Net amount to pay HMRC'}
      </div>
    </div>` : '';

  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>
  * { box-sizing:border-box; margin:0; padding:0; }
  body { font-family:Arial,Helvetica,sans-serif; color:#1a1a1a; font-size:13px;
    -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  table { border-collapse:collapse; width:100%; }
  .section { margin:0 40px 24px; }
  .label { font-size:10px;font-weight:600;text-transform:uppercase;
    letter-spacing:1.5px;color:#aaa;margin-bottom:6px; }
  hr { border:none;border-top:1px solid #e5e7eb;margin:20px 40px; }
</style>
</head><body>

<!-- Header -->
<div style="background:${accent};padding:28px 40px;
  -webkit-print-color-adjust:exact;print-color-adjust:exact;">
  <table><tr>
    <td style="vertical-align:middle;">
      ${logoSrc ? `<img src="${logoSrc}" style="max-height:44px;max-width:140px;object-fit:contain;display:block;margin-bottom:8px;">` : ''}
      <div style="color:white;font-size:18px;font-weight:bold;">${data.contractor_name}</div>
      ${data.contractor_address ? `<div style="color:rgba(255,255,255,0.75);font-size:11px;margin-top:2px;">${data.contractor_address}</div>` : ''}
      ${data.contractor_utr         ? `<div style="color:rgba(255,255,255,0.75);font-size:11px;">Contractor UTR: ${data.contractor_utr}</div>` : ''}
      ${data.accounts_office_ref    ? `<div style="color:rgba(255,255,255,0.75);font-size:11px;">Accounts Office Ref: ${data.accounts_office_ref}</div>` : ''}
    </td>
    <td style="text-align:right;vertical-align:top;">
      <div style="color:rgba(255,255,255,0.75);font-size:10px;text-transform:uppercase;
        letter-spacing:2px;margin-bottom:4px;">CIS Monthly Return (CIS300)</div>
      <div style="color:white;font-size:22px;font-weight:bold;">${data.tax_month_label}</div>
      <div style="color:rgba(255,255,255,0.75);font-size:11px;margin-top:6px;">
        Deadline: ${fmtDate(data.deadline)}
      </div>
      <div style="color:rgba(255,255,255,0.6);font-size:10px;margin-top:3px;">
        Generated: ${fmtDate(data.generated_at)}
      </div>
    </td>
  </tr></table>
</div>

${nilBanner}

${!data.is_nil_return ? `
<!-- Subcontractor table -->
<div class="section" style="margin-top:24px;">
  <div class="label">Subcontractor Payments</div>
  <table style="border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
    <thead>
      <tr style="background:${accent};color:white;
        -webkit-print-color-adjust:exact;print-color-adjust:exact;">
        <th style="padding:9px 10px;text-align:left;font-size:11px;">Subcontractor</th>
        <th style="padding:9px 10px;text-align:left;font-size:11px;">UTR</th>
        <th style="padding:9px 10px;text-align:left;font-size:11px;">Verification No.</th>
        <th style="padding:9px 10px;text-align:center;font-size:11px;">Rate</th>
        <th style="padding:9px 10px;text-align:right;font-size:11px;">Gross</th>
        <th style="padding:9px 10px;text-align:right;font-size:11px;">Materials</th>
        <th style="padding:9px 10px;text-align:right;font-size:11px;">Labour</th>
        <th style="padding:9px 10px;text-align:right;font-size:11px;">CIS Deducted</th>
      </tr>
    </thead>
    <tbody>${subRows}</tbody>
    <tfoot style="border-top:2px solid #e5e7eb;background:#f0f9ff;
      -webkit-print-color-adjust:exact;print-color-adjust:exact;">
      <tr>
        <td colspan="4" style="padding:10px;font-weight:700;font-size:13px;">TOTALS</td>
        <td style="padding:10px;text-align:right;font-weight:700;">${gbp(data.total_gross_pence)}</td>
        <td style="padding:10px;text-align:right;font-weight:700;">${gbp(data.total_materials_pence)}</td>
        <td style="padding:10px;text-align:right;font-weight:700;">${gbp(data.total_labour_pence)}</td>
        <td style="padding:10px;text-align:right;font-weight:700;font-size:14px;color:#dc2626;">
          ${gbp(data.total_deductions_pence)}
        </td>
      </tr>
    </tfoot>
  </table>
</div>

<hr>

<!-- Summary -->
<div class="section">
  <div style="display:flex;gap:20px;">
    <div style="flex:1;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:16px;
      -webkit-print-color-adjust:exact;print-color-adjust:exact;">
      <div class="label" style="color:#dc2626;">Total CIS to deduct</div>
      <div style="font-size:24px;font-weight:bold;color:#dc2626;">${gbp(data.total_deductions_pence)}</div>
      <div style="font-size:11px;color:#888;margin-top:3px;">
        You must pay this to HMRC by ${fmtDate(data.deadline)}
      </div>
    </div>
    ${sufferedCards}
  </div>
</div>` : ''}

<hr>

<!-- How to submit -->
<div class="section">
  <div class="label">How to Submit This Return</div>
  <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:16px;
    -webkit-print-color-adjust:exact;print-color-adjust:exact;">
    <p style="font-size:13px;color:#92400e;font-weight:600;margin-bottom:8px;">
      Submit by ${fmtDate(data.deadline)} to avoid penalties
    </p>
    <ol style="font-size:12px;color:#78350f;padding-left:16px;line-height:2;">
      <li>Go to <strong>www.gov.uk/send-cis-monthly-returns</strong></li>
      <li>Sign in with your HMRC Government Gateway credentials</li>
      <li>Select <strong>Construction Industry Scheme</strong></li>
      <li>Enter the figures from this return for each subcontractor</li>
      <li>Submit and keep the HMRC confirmation reference</li>
    </ol>
  </div>
</div>

<!-- Legal footer -->
<div style="margin:16px 40px 0;padding:14px;background:#fafafa;
  border:1px solid #e5e7eb;border-radius:8px;">
  <p style="font-size:11px;color:#888;line-height:1.6;">
    This CIS300 return was prepared under the Construction Industry Scheme.
    Late filing penalty: £100 per month (up to 12 months late), then higher penalties apply.
    Keep copies of all returns for 3 years.
    Produced by Vantro &middot; ${data.contractor_name}
  </p>
</div>

</body></html>`;
}
