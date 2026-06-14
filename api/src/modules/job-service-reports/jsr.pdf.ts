import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

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

const fmtDate = (d?: string | Date | null): string =>
  d ? new Date(d as string).toLocaleDateString('en-GB', {
    day: '2-digit', month: 'long', year: 'numeric',
  }) : '—';

const fmtTime = (d?: string | Date | null): string =>
  d ? new Date(d as string).toLocaleTimeString('en-GB', {
    hour: '2-digit', minute: '2-digit',
  }) : '—';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildJsrHtml(jsr: any, job: any, company: any): string {
  const accent   = company.invoice_accent_colour ?? '#1d4ed8';
  const logoSrc  = getLogoBase64(company.logo_url);
  const coAddr   = [company.address_line1, company.city, company.postcode].filter(Boolean).join(', ');
  const custAddr = [job.customer?.address_line1, job.customer?.city, job.customer?.postcode].filter(Boolean).join(', ');

  const statusBadge: Record<string, string> = {
    DRAFT:    `<span style="background:#f1f5f9;color:#475569;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:bold;">Draft</span>`,
    SENT:     `<span style="background:#dbeafe;color:#1d4ed8;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:bold;">Sent</span>`,
    ACCEPTED: `<span style="background:#dcfce7;color:#16a34a;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:bold;">✓ Accepted</span>`,
    DECLINED: `<span style="background:#fee2e2;color:#dc2626;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:bold;">Declined</span>`,
  };

  const timesheetRows = jsr.show_timesheets && job.timesheets?.length
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ? job.timesheets.map((ts: any) => `
      <tr>
        <td style="padding:8px 12px;font-size:12px;">${ts.user?.name ?? '—'}</td>
        <td style="padding:8px 12px;font-size:12px;">${fmtDate(ts.date)}</td>
        <td style="padding:8px 12px;font-size:12px;text-align:center;">${fmtTime(ts.clock_in_at ?? ts.start_time)}</td>
        <td style="padding:8px 12px;font-size:12px;text-align:center;">${fmtTime(ts.clock_out_at ?? ts.finish_time)}</td>
        <td style="padding:8px 12px;font-size:12px;text-align:right;">
          ${Math.floor(ts.duration_minutes / 60)}h${ts.duration_minutes % 60 > 0 ? ` ${ts.duration_minutes % 60}m` : ''}
        </td>
      </tr>`).join('')
    : '';

  const certRows = jsr.show_certs && job.gasCertificates?.length
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ? job.gasCertificates.map((cert: any) => {
        const typeLabel: Record<string, string> = {
          CP12: 'Gas Safety (CP12)', BOILER_SERVICE: 'Boiler Service',
          GAS_WARNING: 'Gas Warning', INSTALLATION: 'Installation Record',
        };
        const statusColor: Record<string, string> = {
          DRAFT: '#94a3b8', COMPLETE: '#16a34a', SENT: '#1d4ed8',
        };
        return `
        <tr>
          <td style="padding:8px 12px;font-size:12px;font-family:monospace;font-weight:600;">${cert.cert_number}</td>
          <td style="padding:8px 12px;font-size:12px;">${typeLabel[cert.cert_type] ?? cert.cert_type}</td>
          <td style="padding:8px 12px;font-size:12px;">${fmtDate(cert.inspection_date)}</td>
          <td style="padding:8px 12px;font-size:12px;">
            <span style="color:${statusColor[cert.status] ?? '#555'};font-weight:600;">${cert.status}</span>
          </td>
        </tr>`;
      }).join('')
    : '';

  const photoGrid = jsr.show_photos && job.photos?.length
    ? `<div style="display:flex;flex-wrap:wrap;gap:12px;margin-top:8px;">
        ${(job.photos as any[]).slice(0, 9).map((p: any) => `
          <div style="text-align:center;">
            <img src="${p.url}" style="width:160px;height:120px;object-fit:cover;border-radius:6px;border:1px solid #e5e7eb;">
            <p style="font-size:10px;color:#888;margin:4px 0 0;">${p.phase ?? ''}${p.caption ? ` · ${p.caption}` : ''}</p>
          </div>`).join('')}
      </div>`
    : '';

  // Total time calculation
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const totalMins: number = (job.timesheets as any[] ?? []).reduce((s: number, t: any) => s + (t.duration_minutes ?? 0), 0);
  const totalTimeStr = `${Math.floor(totalMins / 60)}h${totalMins % 60 > 0 ? ` ${totalMins % 60}m` : ''}`;

  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, Helvetica, sans-serif; color: #1a1a1a; font-size: 13px; line-height: 1.5;
    -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  table { border-collapse: collapse; width: 100%; }
  th { background: ${accent}; color: white; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; }
  tr:nth-child(even) { background: #f9fafb; }
  .section { margin: 0 44px 24px; }
  .section-title { font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 1.5px; color: #aaa; margin-bottom: 8px; }
  .divider { border: none; border-top: 1px solid #e5e7eb; margin: 20px 44px; }
</style>
</head><body>

<!-- Header -->
<div style="background:${accent};padding:32px 44px;-webkit-print-color-adjust:exact;print-color-adjust:exact;">
  <table><tr>
    <td style="vertical-align:middle;">
      ${logoSrc ? `<img src="${logoSrc}" style="max-height:52px;max-width:160px;object-fit:contain;display:block;margin-bottom:10px;">` : ''}
      <div style="color:white;font-size:20px;font-weight:bold;">${company.name}</div>
      ${coAddr ? `<div style="color:rgba(255,255,255,0.75);font-size:11px;margin-top:3px;">${coAddr}</div>` : ''}
      ${company.phone ? `<div style="color:rgba(255,255,255,0.75);font-size:11px;">${company.phone}</div>` : ''}
    </td>
    <td style="text-align:right;vertical-align:top;">
      <div style="color:white;font-size:11px;text-transform:uppercase;letter-spacing:2px;opacity:0.8;margin-bottom:6px;">
        ${jsr.title ?? 'Job Service Report'}
      </div>
      <div style="color:white;font-size:28px;font-weight:bold;letter-spacing:-0.5px;">${jsr.report_number}</div>
      <div style="margin-top:6px;">${statusBadge[jsr.status] ?? ''}</div>
      <div style="color:rgba(255,255,255,0.8);font-size:12px;margin-top:8px;">${fmtDate(jsr.report_date)}</div>
    </td>
  </tr></table>
</div>

<!-- Customer + Job Info -->
<div style="padding:28px 44px 0;">
  <table><tr>
    <td style="width:50%;vertical-align:top;padding-right:40px;">
      <div class="section-title">Prepared For</div>
      <div style="font-size:15px;font-weight:bold;">${job.customer?.name ?? '—'}</div>
      ${custAddr ? `<div style="color:#666;font-size:12px;margin-top:4px;">${custAddr}</div>` : ''}
      ${job.customer?.email ? `<div style="color:#666;font-size:12px;">${job.customer.email}</div>` : ''}
    </td>
    <td style="vertical-align:top;">
      <div class="section-title">Job Details</div>
      <table style="border-collapse:collapse;font-size:12px;">
        <tr><td style="color:#999;padding:3px 20px 3px 0;white-space:nowrap;">Job</td><td style="font-weight:600;">${job.title}</td></tr>
        <tr><td style="color:#999;padding:3px 20px 3px 0;">Date</td><td>${fmtDate(job.scheduled_at)}</td></tr>
        ${job.engineer ? `<tr><td style="color:#999;padding:3px 20px 3px 0;">Engineer</td><td>${job.engineer.name}</td></tr>` : ''}
        <tr><td style="color:#999;padding:3px 20px 3px 0;">Status</td><td style="font-weight:600;color:#16a34a;">${String(job.status).replace('_', ' ')}</td></tr>
      </table>
    </td>
  </tr></table>
</div>

<hr class="divider">

${jsr.description ? `
<div class="section">
  <div class="section-title">Work Carried Out</div>
  <div style="font-size:13px;color:#333;white-space:pre-line;line-height:1.7;">${jsr.description}</div>
</div>
<hr class="divider">` : ''}

${jsr.show_timesheets && job.timesheets?.length ? `
<div class="section">
  <div class="section-title">Time On Site</div>
  <table style="border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
    <thead><tr>
      <th style="padding:10px 12px;text-align:left;">Engineer</th>
      <th style="padding:10px 12px;text-align:left;">Date</th>
      <th style="padding:10px 12px;text-align:center;">Start</th>
      <th style="padding:10px 12px;text-align:center;">Finish</th>
      <th style="padding:10px 12px;text-align:right;">Duration</th>
    </tr></thead>
    <tbody>${timesheetRows}</tbody>
    <tfoot>
      <tr style="border-top:2px solid #e5e7eb;">
        <td colspan="4" style="padding:10px 12px;font-weight:600;font-size:12px;">Total</td>
        <td style="padding:10px 12px;text-align:right;font-weight:700;font-size:14px;">${totalTimeStr}</td>
      </tr>
    </tfoot>
  </table>
</div>
<hr class="divider">` : ''}

${jsr.show_certs && job.gasCertificates?.length ? `
<div class="section">
  <div class="section-title">Compliance Certificates</div>
  <table style="border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
    <thead><tr>
      <th style="padding:10px 12px;text-align:left;">Cert No.</th>
      <th style="padding:10px 12px;text-align:left;">Type</th>
      <th style="padding:10px 12px;text-align:left;">Inspection Date</th>
      <th style="padding:10px 12px;text-align:left;">Status</th>
    </tr></thead>
    <tbody>${certRows}</tbody>
  </table>
</div>
<hr class="divider">` : ''}

${jsr.show_photos && job.photos?.length ? `
<div class="section">
  <div class="section-title">Photos (${job.photos.length})</div>
  ${photoGrid}
</div>
<hr class="divider">` : ''}

${jsr.show_notes && job.notes ? `
<div class="section">
  <div class="section-title">Notes</div>
  <div style="font-size:13px;color:#555;white-space:pre-line;">${job.notes}</div>
</div>
<hr class="divider">` : ''}

${jsr.accepted_at ? `
<div class="section">
  <div style="background:#dcfce7;border:1px solid #bbf7d0;border-radius:8px;padding:14px 16px;">
    <p style="color:#16a34a;font-weight:600;font-size:13px;">
      ✓ Accepted by customer on ${fmtDate(jsr.accepted_at)}
    </p>
  </div>
</div>` : ''}

${jsr.terms ? `
<div class="section">
  <div class="section-title">Terms</div>
  <div style="font-size:11px;color:#888;white-space:pre-line;">${jsr.terms}</div>
</div>` : ''}

<!-- Footer -->
<div style="border-top:1px solid #eee;padding:14px 44px;background:#fafafa;
  -webkit-print-color-adjust:exact;print-color-adjust:exact;">
  <div style="font-size:11px;color:#bbb;text-align:center;">
    ${[company.name, company.address_line1, company.postcode, company.phone].filter(Boolean).join(' · ')}
  </div>
</div>

</body></html>`;
}
