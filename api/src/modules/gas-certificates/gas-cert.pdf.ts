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
    const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : 'image/png';
    return `data:${mime};base64,${buf.toString('base64')}`;
  } catch { return null; }
}

const fmtDate = (d?: string | Date | null): string => {
  if (!d) return '—';
  return new Date(d as string).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });
};

const row = (label: string, value: string, coloured = false) =>
  `<tr>
    <td style="padding:5px 12px 5px 0;color:#666;font-size:12px;white-space:nowrap;width:45%;">${label}</td>
    <td style="padding:5px 0;font-size:12px;font-weight:600;color:${coloured ? '#dc2626' : '#111'};">${value || '—'}</td>
  </tr>`;

const checkRow = (label: string, value: string) => {
  const color = value === 'PASS' || value === 'SATISFACTORY' || value === 'YES' ? '#16a34a'
    : value === 'FAIL' || value === 'UNSATISFACTORY' || value === 'NO' ? '#dc2626'
    : '#888';
  return `<tr>
    <td style="padding:4px 12px 4px 0;color:#666;font-size:11px;">${label}</td>
    <td style="padding:4px 0;font-size:11px;font-weight:700;color:${color};">${value?.replace(/_/g, ' ') || '—'}</td>
  </tr>`;
};

function header(cert: any, co: any, accent: string, logoSrc: string | null, typeLabel: string, typeBadgeColour: string): string {
  const coAddr = [co.address_line1, co.city, co.postcode].filter(Boolean).join(', ');
  const propAddr = [cert.property_address, cert.property_city, cert.property_postcode].filter(Boolean).join(', ');

  return `
<div style="background:${accent};padding:28px 40px;-webkit-print-color-adjust:exact;print-color-adjust:exact;">
  <table style="width:100%;border-collapse:collapse;"><tr>
    <td style="vertical-align:middle;">
      ${logoSrc ? `<img src="${logoSrc}" alt="logo" style="max-height:48px;max-width:140px;object-fit:contain;display:block;margin-bottom:8px;">` : ''}
      <div style="color:white;font-size:18px;font-weight:bold;">${co.name ?? ''}</div>
      ${coAddr ? `<div style="color:rgba(255,255,255,0.8);font-size:11px;margin-top:2px;">${coAddr}</div>` : ''}
      ${co.phone ? `<div style="color:rgba(255,255,255,0.75);font-size:11px;">${co.phone}</div>` : ''}
    </td>
    <td style="text-align:right;vertical-align:top;">
      <div style="display:inline-block;background:${typeBadgeColour};color:white;padding:6px 14px;border-radius:20px;font-size:11px;font-weight:bold;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">${typeLabel}</div>
      <div style="color:white;font-size:22px;font-weight:bold;line-height:1;">${cert.cert_number}</div>
      <div style="color:rgba(255,255,255,0.85);font-size:11px;margin-top:4px;">${fmtDate(cert.inspection_date)}</div>
      ${co.cis_number ? `<div style="color:rgba(255,255,255,0.7);font-size:10px;margin-top:2px;">Gas Safe Reg: ${co.cis_number}</div>` : ''}
    </td>
  </tr></table>
</div>

<div style="background:#f8f9fa;padding:10px 40px;border-bottom:1px solid #e5e7eb;">
  <table style="width:100%;border-collapse:collapse;font-size:12px;"><tr>
    <td style="width:50%;padding-right:20px;">
      <span style="color:#888;font-size:10px;text-transform:uppercase;letter-spacing:1px;">Property / Site Address</span><br>
      <strong>${propAddr || 'See notes'}</strong>
    </td>
    <td>
      <span style="color:#888;font-size:10px;text-transform:uppercase;letter-spacing:1px;">Customer</span><br>
      <strong>${cert.customer?.name ?? '—'}</strong>
      ${cert.customer?.email ? `<span style="color:#888;"> · ${cert.customer.email}</span>` : ''}
    </td>
  </tr></table>
</div>`;
}

function signatureSection(cert: any, data: Record<string, unknown>): string {
  const sig = data.engineer_signature as string | undefined;
  return `
<div style="padding:16px 40px;border-top:1px solid #e5e7eb;">
  <table style="width:100%;border-collapse:collapse;"><tr>
    <td style="width:60%;vertical-align:top;padding-right:40px;">
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#aaa;margin-bottom:8px;font-weight:600;">Engineer Signature</div>
      ${sig ? `<img src="${sig}" style="max-height:60px;max-width:240px;object-fit:contain;border-bottom:1px solid #333;">` : '<div style="height:60px;border-bottom:1px solid #333;width:240px;"></div>'}
      <div style="font-size:12px;color:#333;margin-top:6px;">${cert.engineer_name ?? ''}</div>
      <div style="font-size:11px;color:#888;">Gas Safe No: ${cert.gas_safe_number ?? '________________'}</div>
    </td>
    <td style="vertical-align:top;">
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#aaa;margin-bottom:8px;font-weight:600;">Date</div>
      <div style="height:60px;border-bottom:1px solid #333;width:160px;"></div>
      <div style="font-size:12px;color:#333;margin-top:6px;">${fmtDate(cert.inspection_date)}</div>
    </td>
  </tr></table>
</div>`;
}

function footer(co: any): string {
  return `
<div style="border-top:1px solid #eee;padding:10px 40px;background:#fafafa;-webkit-print-color-adjust:exact;print-color-adjust:exact;">
  <div style="font-size:10px;color:#bbb;text-align:center;">
    This certificate was produced using Vantro &middot; ${co.name ?? ''}
    ${co.vat_registered && co.vat_number ? ` &middot; VAT: ${co.vat_number}` : ''}
  </div>
</div>`;
}

const BASE_HTML = (accent: string) => `<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,Helvetica,sans-serif;color:#1a1a1a;background:white;font-size:13px;line-height:1.5;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.section{padding:16px 40px;border-bottom:1px solid #f0f0f0;}
.section-title{font-size:10px;text-transform:uppercase;letter-spacing:1.5px;color:#aaa;font-weight:600;margin-bottom:10px;}
table{width:100%;border-collapse:collapse;}
</style></head><body>`;

// ─── CP12 ─────────────────────────────────────────────────────────────────────

function buildCP12(cert: any, co: any, accent: string, logoSrc: string | null): string {
  const data = (cert.data ?? {}) as Record<string, unknown>;
  const appliances = (data.appliances as any[]) ?? [];

  const applianceRows = appliances.length === 0
    ? `<tr><td colspan="8" style="padding:12px;text-align:center;color:#999;font-size:11px;">No appliances recorded</td></tr>`
    : appliances.map((a: any, i: number) => `
      <tr style="background:${i % 2 === 0 ? '#f9fafb' : 'white'};">
        <td style="padding:6px 8px;font-size:11px;border:1px solid #e5e7eb;">${a.appliance_type ?? '—'}</td>
        <td style="padding:6px 8px;font-size:11px;border:1px solid #e5e7eb;">${a.location ?? '—'}</td>
        <td style="padding:6px 8px;font-size:11px;border:1px solid #e5e7eb;">${a.make_model ?? '—'}</td>
        <td style="padding:6px 8px;font-size:11px;border:1px solid #e5e7eb;">${a.flue_type ?? '—'}</td>
        <td style="padding:6px 8px;font-size:11px;border:1px solid #e5e7eb;color:${a.flue_condition === 'SATISFACTORY' ? '#16a34a' : '#dc2626'};">${(a.flue_condition ?? '—').replace('_', ' ')}</td>
        <td style="padding:6px 8px;font-size:11px;border:1px solid #e5e7eb;text-align:center;">${a.physically_checked ? '✓' : '✗'}</td>
        <td style="padding:6px 8px;font-size:11px;border:1px solid #e5e7eb;color:${a.safety_devices_ok === 'YES' ? '#16a34a' : a.safety_devices_ok === 'NO' ? '#dc2626' : '#888'};">${a.safety_devices_ok ?? '—'}</td>
        <td style="padding:6px 8px;font-size:11px;border:1px solid #e5e7eb;color:${a.condition === 'SATISFACTORY' ? '#16a34a' : a.condition === 'UNSATISFACTORY' ? '#dc2626' : '#888'};font-weight:700;">${(a.condition ?? '—').replace('_', ' ')}</td>
      </tr>`).join('');

  const overallResult = data.overall_result as string ?? 'INCOMPLETE';
  const resultBg = overallResult === 'PASS' ? '#16a34a' : overallResult === 'FAIL' ? '#dc2626' : '#d97706';

  return `${BASE_HTML(accent)}
${header(cert, co, accent, logoSrc, 'CP12 — Gas Safety Record', '#16a34a')}

<div class="section">
  <div class="section-title">Landlord / Property Details</div>
  <table style="width:auto;"><tbody>
    ${row('Landlord Name', data.landlord_name as string ?? '')}
    ${row('Landlord Address', data.landlord_address as string ?? '')}
    ${row('Gas Pipework Condition', (data.gas_pipework_condition as string ?? '').replace('_', ' '))}
    ${row('Warning Notice Issued', data.warning_notice_issued ? 'Yes' : 'No', data.warning_notice_issued as boolean)}
  </tbody></table>
</div>

<div class="section">
  <div class="section-title">Appliances Inspected</div>
  <table style="font-size:11px;border-collapse:collapse;width:100%;">
    <thead><tr style="background:${accent};color:white;-webkit-print-color-adjust:exact;print-color-adjust:exact;">
      <th style="padding:6px 8px;border:1px solid #ccc;text-align:left;">Type</th>
      <th style="padding:6px 8px;border:1px solid #ccc;text-align:left;">Location</th>
      <th style="padding:6px 8px;border:1px solid #ccc;text-align:left;">Make/Model</th>
      <th style="padding:6px 8px;border:1px solid #ccc;text-align:left;">Flue Type</th>
      <th style="padding:6px 8px;border:1px solid #ccc;text-align:left;">Flue Cond.</th>
      <th style="padding:6px 8px;border:1px solid #ccc;text-align:center;">Checked</th>
      <th style="padding:6px 8px;border:1px solid #ccc;text-align:left;">Safety Devices</th>
      <th style="padding:6px 8px;border:1px solid #ccc;text-align:left;">Condition</th>
    </tr></thead>
    <tbody>${applianceRows}</tbody>
  </table>
</div>

<div class="section">
  <table><tr>
    <td style="width:70%;padding-right:20px;">
      <div class="section-title">Legal Declaration</div>
      <p style="font-size:11px;color:#555;line-height:1.6;">I certify that the gas appliances/installation at the above address have been checked in accordance with the Gas Safety (Installation and Use) Regulations 1998 and that the appliances/installation checked are in a safe condition.</p>
      ${cert.next_due_date ? `<p style="font-size:11px;color:#555;margin-top:8px;">Next inspection due: <strong>${fmtDate(cert.next_due_date)}</strong></p>` : ''}
      ${cert.notes ? `<p style="font-size:11px;color:#555;margin-top:8px;"><strong>Notes:</strong> ${cert.notes}</p>` : ''}
    </td>
    <td style="text-align:center;vertical-align:middle;">
      <div style="display:inline-block;background:${resultBg};color:white;padding:16px 24px;border-radius:8px;font-size:20px;font-weight:bold;-webkit-print-color-adjust:exact;print-color-adjust:exact;">${overallResult}</div>
    </td>
  </tr></table>
</div>

${signatureSection(cert, data)}
${footer(co)}
</body></html>`;
}

// ─── BOILER_SERVICE ───────────────────────────────────────────────────────────

function buildBoilerService(cert: any, co: any, accent: string, logoSrc: string | null): string {
  const data = (cert.data ?? {}) as Record<string, unknown>;
  const overallResult = data.overall_result as string ?? '—';
  const resultBg = overallResult === 'PASS' ? '#16a34a' : overallResult === 'FAIL' ? '#dc2626' : '#d97706';

  return `${BASE_HTML(accent)}
${header(cert, co, accent, logoSrc, 'Boiler Service Record', '#2563eb')}

<div style="padding:16px 40px;display:flex;gap:20px;border-bottom:1px solid #f0f0f0;">
  <div style="flex:1;padding-right:20px;border-right:1px solid #f0f0f0;">
    <div class="section-title" style="font-size:10px;text-transform:uppercase;letter-spacing:1.5px;color:#aaa;font-weight:600;margin-bottom:10px;">Appliance Details</div>
    <table style="width:auto;"><tbody>
      ${row('Make', data.boiler_make as string ?? '')}
      ${row('Model', data.boiler_model as string ?? '')}
      ${row('Serial No.', data.boiler_serial as string ?? '')}
      ${row('Location', data.boiler_location as string ?? '')}
      ${row('Type', (data.boiler_type as string ?? '').replace('_', ' '))}
    </tbody></table>
  </div>
  <div style="flex:1;padding-left:20px;">
    <div class="section-title" style="font-size:10px;text-transform:uppercase;letter-spacing:1.5px;color:#aaa;font-weight:600;margin-bottom:10px;">Readings</div>
    <table style="width:auto;"><tbody>
      ${row('Gas Rate (m³/h)', data.gas_rate_m3h != null ? String(data.gas_rate_m3h) : '')}
      ${row('Operating Pressure (mbar)', data.operating_pressure_mbar != null ? String(data.operating_pressure_mbar) : '')}
      ${row('CO Reading (ppm)', data.co_reading_ppm != null ? String(data.co_reading_ppm) : '')}
      ${row('CO₂ (%)', data.co2_percentage != null ? String(data.co2_percentage) : '')}
    </tbody></table>
  </div>
</div>

<div style="padding:16px 40px;border-bottom:1px solid #f0f0f0;">
  <div class="section-title" style="font-size:10px;text-transform:uppercase;letter-spacing:1.5px;color:#aaa;font-weight:600;margin-bottom:10px;">Inspection Checks</div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:0 40px;">
    <table><tbody>
      ${checkRow('Flue Flow Test', data.flue_flow_test as string ?? '')}
      ${checkRow('Combustion Test', data.combustion_test as string ?? '')}
      ${checkRow('Heat Exchanger', data.heat_exchanger as string ?? '')}
      ${checkRow('Burner Condition', data.burner_condition as string ?? '')}
    </tbody></table>
    <table><tbody>
      ${checkRow('Ignition Leads', data.ignition_leads as string ?? '')}
      ${checkRow('Expansion Vessel', data.expansion_vessel as string ?? '')}
      ${checkRow('Controls Operation', data.controls_operation as string ?? '')}
    </tbody></table>
  </div>
</div>

<div style="padding:16px 40px;border-bottom:1px solid #f0f0f0;">
  <div class="section-title" style="font-size:10px;text-transform:uppercase;letter-spacing:1.5px;color:#aaa;font-weight:600;margin-bottom:10px;">Service Tasks</div>
  <table style="width:auto;"><tbody>
    ${row('Condensate Trap Cleaned', data.condensate_trap_cleaned ? 'Yes' : 'No')}
    ${row('Filter Cleaned', data.filter_cleaned ? 'Yes' : 'No')}
    ${data.parts_replaced ? row('Parts Replaced', data.parts_replaced as string) : ''}
    ${cert.next_due_date ? row('Next Service Due', fmtDate(cert.next_due_date)) : ''}
    ${cert.notes ? row('Notes', cert.notes) : ''}
  </tbody></table>
</div>

<div style="padding:16px 40px;border-bottom:1px solid #f0f0f0;display:flex;align-items:center;justify-content:space-between;">
  <p style="font-size:12px;color:#555;">Serviced in accordance with manufacturer's instructions and current regulations.</p>
  <div style="background:${resultBg};color:white;padding:12px 20px;border-radius:8px;font-size:18px;font-weight:bold;-webkit-print-color-adjust:exact;print-color-adjust:exact;">${overallResult}</div>
</div>

${signatureSection(cert, data)}
${footer(co)}
</body></html>`;
}

// ─── GAS_WARNING ──────────────────────────────────────────────────────────────

function buildGasWarning(cert: any, co: any, accent: string, logoSrc: string | null): string {
  const data = (cert.data ?? {}) as Record<string, unknown>;
  const classification = data.classification as string ?? 'AR';
  const classBg = classification === 'ID' ? '#dc2626' : classification === 'AR' ? '#d97706' : '#ca8a04';
  const classLabel = classification === 'ID' ? 'IMMEDIATELY DANGEROUS' : classification === 'AR' ? 'AT RISK' : 'NOT TO CURRENT STANDARDS';
  const actionTaken = (data.action_taken as string ?? '').replace(/_/g, ' ');

  return `${BASE_HTML(accent)}
${header(cert, co, accent, logoSrc, 'Gas Warning Notice', classBg)}

<div style="margin:16px 40px;background:${classBg};border-radius:8px;padding:16px 20px;-webkit-print-color-adjust:exact;print-color-adjust:exact;">
  <div style="color:white;font-size:11px;text-transform:uppercase;letter-spacing:2px;font-weight:600;margin-bottom:4px;">Classification</div>
  <div style="color:white;font-size:22px;font-weight:bold;">${classification} — ${classLabel}</div>
</div>

<div class="section">
  <div class="section-title" style="font-size:10px;text-transform:uppercase;letter-spacing:1.5px;color:#aaa;font-weight:600;margin-bottom:10px;">Appliance Details</div>
  <table style="width:auto;"><tbody>
    ${row('Appliance Type', data.appliance_type as string ?? '')}
    ${row('Location', data.appliance_location as string ?? '')}
    ${row('Make/Model', data.make_model as string ?? '')}
  </tbody></table>
</div>

<div class="section">
  <div class="section-title" style="font-size:10px;text-transform:uppercase;letter-spacing:1.5px;color:#aaa;font-weight:600;margin-bottom:8px;">Fault / Defect Description</div>
  <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:6px;padding:12px 16px;font-size:12px;color:#7c2d12;line-height:1.6;">
    ${data.fault_description as string ?? 'No description provided.'}
  </div>
</div>

<div class="section">
  <div class="section-title" style="font-size:10px;text-transform:uppercase;letter-spacing:1.5px;color:#aaa;font-weight:600;margin-bottom:10px;">Action Taken</div>
  <table style="width:auto;"><tbody>
    ${row('Action', actionTaken)}
    ${data.action_details ? row('Details', data.action_details as string) : ''}
    ${row('Warning Issued To', data.warning_issued_to as string ?? '')}
    ${row('Owner Refused Action', data.owner_refused_action ? 'YES — Refused' : 'No')}
  </tbody></table>
</div>

<div class="section">
  <p style="font-size:11px;color:#555;line-height:1.6;">
    This Gas Warning Notice has been issued in accordance with Gas Safe Register procedures. The appliance/installation described above has been identified as ${classLabel}.
    ${classification === 'ID' ? 'The gas supply has been capped or the appliance disconnected. Do not use until repaired by a Gas Safe Registered engineer.' : ''}
  </p>
  ${cert.notes ? `<p style="font-size:11px;color:#555;margin-top:8px;"><strong>Notes:</strong> ${cert.notes}</p>` : ''}
</div>

${signatureSection(cert, data)}
${footer(co)}
</body></html>`;
}

// ─── INSTALLATION ─────────────────────────────────────────────────────────────

function buildInstallation(cert: any, co: any, accent: string, logoSrc: string | null): string {
  const data = (cert.data ?? {}) as Record<string, unknown>;
  const overallResult = data.overall_result as string ?? '—';
  const resultBg = overallResult === 'PASS' ? '#16a34a' : '#dc2626';

  return `${BASE_HTML(accent)}
${header(cert, co, accent, logoSrc, 'Installation Record (Pad 17)', '#7c3aed')}

<div style="padding:16px 40px;display:flex;gap:20px;border-bottom:1px solid #f0f0f0;">
  <div style="flex:1;padding-right:20px;border-right:1px solid #f0f0f0;">
    <div class="section-title" style="font-size:10px;text-transform:uppercase;letter-spacing:1.5px;color:#aaa;font-weight:600;margin-bottom:10px;">Appliance Details</div>
    <table style="width:auto;"><tbody>
      ${row('Type', data.appliance_type as string ?? '')}
      ${row('Make/Model', data.make_model as string ?? '')}
      ${row('Serial Number', data.serial_number as string ?? '')}
      ${row('Location', data.location as string ?? '')}
      ${row('Installation Type', data.installation_type as string ?? '')}
    </tbody></table>
  </div>
  <div style="flex:1;padding-left:20px;">
    <div class="section-title" style="font-size:10px;text-transform:uppercase;letter-spacing:1.5px;color:#aaa;font-weight:600;margin-bottom:10px;">Commissioning Readings</div>
    <table style="width:auto;"><tbody>
      ${row('CO Reading (ppm)', data.co_reading_ppm != null ? String(data.co_reading_ppm) : '')}
      ${row('Operating Pressure (mbar)', data.operating_pressure_mbar != null ? String(data.operating_pressure_mbar) : '')}
      ${row('Gas Rate (m³/h)', data.gas_rate_m3h != null ? String(data.gas_rate_m3h) : '')}
    </tbody></table>
  </div>
</div>

<div style="padding:16px 40px;border-bottom:1px solid #f0f0f0;">
  <div class="section-title" style="font-size:10px;text-transform:uppercase;letter-spacing:1.5px;color:#aaa;font-weight:600;margin-bottom:10px;">Test Results</div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:0 40px;">
    <table><tbody>
      ${checkRow('Gas Tightness Test', data.gas_tightness_test as string ?? '')}
      ${checkRow('Let-By Test', data.let_by_test as string ?? '')}
    </tbody></table>
    <table><tbody>
      ${checkRow('Flue Flow Test', data.flue_flow_test as string ?? '')}
      ${checkRow('Combustion Analysis', data.combustion_analysis as string ?? '')}
    </tbody></table>
  </div>
</div>

<div style="padding:16px 40px;border-bottom:1px solid #f0f0f0;">
  <div class="section-title" style="font-size:10px;text-transform:uppercase;letter-spacing:1.5px;color:#aaa;font-weight:600;margin-bottom:10px;">Commissioning Checklist</div>
  <table style="width:auto;"><tbody>
    ${row('Building Regs Notification', data.building_regs_notification ? 'Yes — Notified' : 'No')}
    ${row('Controls Commissioned', data.controls_commissioned ? 'Yes' : 'No')}
    ${row('Benchmark Completed', data.benchmark_completed ? 'Yes' : 'No')}
    ${cert.notes ? row('Notes', cert.notes) : ''}
  </tbody></table>
</div>

<div style="padding:16px 40px;border-bottom:1px solid #f0f0f0;display:flex;align-items:center;justify-content:space-between;">
  <p style="font-size:12px;color:#555;">This appliance has been installed and commissioned in accordance with the manufacturer's instructions and current Gas Safety Regulations.</p>
  <div style="background:${resultBg};color:white;padding:12px 20px;border-radius:8px;font-size:18px;font-weight:bold;-webkit-print-color-adjust:exact;print-color-adjust:exact;">${overallResult}</div>
</div>

${signatureSection(cert, data)}
${footer(co)}
</body></html>`;
}

// ─── Main export ──────────────────────────────────────────────────────────────

export function buildGasCertHtml(cert: any, company: any): string {
  const accent = company.invoice_accent_colour ?? '#1d4ed8';
  const showLogo = company.invoice_show_logo !== false;
  const logoSrc = showLogo ? getLogoBase64(company.logo_url as string | null) : null;

  switch (cert.cert_type as string) {
    case 'BOILER_SERVICE': return buildBoilerService(cert, company, accent, logoSrc);
    case 'GAS_WARNING':    return buildGasWarning(cert, company, accent, logoSrc);
    case 'INSTALLATION':   return buildInstallation(cert, company, accent, logoSrc);
    default:               return buildCP12(cert, company, accent, logoSrc);
  }
}
