interface ReportData {
  company_name: string;
  logo_url: string | null;
  accent_colour: string | null;
  period: string;
  generated_at: Date;

  revenue: {
    total_pounds: number;
    previous_pounds: number;
    change_percent: number | null;
    invoice_count: number;
    average_pounds: number;
  };
  invoices: {
    outstanding_pounds: number;
    overdue_pounds: number;
    outstanding_count: number;
    overdue_count: number;
  };
  debtors: Array<{
    name: string;
    total_owed_pounds: number;
    invoice_count: number;
    oldest_days: number;
  }>;
  cash_flow: {
    income_pounds: number;
    expenses_pounds: number;
    net_pounds: number;
  };
  jobs: {
    completed: number;
    in_progress: number;
    scheduled: number;
  };
  quotes: {
    pipeline_pounds: number;
    sent_count: number;
    accepted_count: number;
    conversion_rate: number | null;
  };
  cis: {
    tax_month_label: string;
    liability_pounds: number;
    deadline: string;
    days_until_deadline: number;
    submitted: boolean;
  } | null;
  team: Array<{
    name: string;
    hours_logged: number;
    jobs_completed: number;
  }>;
  highlights: string[];
}

export function buildBusinessReportHtml(data: ReportData): string {
  const accent = data.accent_colour ?? '#2563eb';
  const gbp = (n: number) => `£${n.toFixed(2)}`;
  const pct = (n: number | null) => n !== null ? `${n > 0 ? '+' : ''}${n}%` : '—';

  const changeColour = (n: number | null) => {
    if (n === null) return '#6b7280';
    return n >= 0 ? '#059669' : '#dc2626';
  };

  const logoHtml = data.logo_url
    ? `<img src="${data.logo_url}" alt="Logo" style="max-height:48px;max-width:160px;object-fit:contain;">`
    : '';

  const debtorRows = data.debtors.slice(0, 5).map(d => `
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">${d.name}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:600;">${gbp(d.total_owed_pounds)}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:center;">${d.invoice_count}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:center;color:${d.oldest_days > 60 ? '#dc2626' : d.oldest_days > 30 ? '#d97706' : '#059669'};">${d.oldest_days} days</td>
    </tr>
  `).join('');

  const teamRows = data.team.map(e => `
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">${e.name}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:center;">${e.hours_logged.toFixed(1)} hrs</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:center;">${e.jobs_completed}</td>
    </tr>
  `).join('');

  const highlightItems = data.highlights.map(h =>
    `<li style="margin-bottom:8px;padding-left:8px;">${h}</li>`,
  ).join('');

  const cisSection = data.cis ? `
    <div style="margin-bottom:28px;">
      <h3 style="font-size:15px;font-weight:700;color:#1f2937;margin:0 0 14px;padding-bottom:8px;border-bottom:2px solid ${accent};">CIS Position — ${data.cis.tax_month_label}</h3>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;">
        <div style="background:#f0fdf4;border-radius:10px;padding:14px;">
          <div style="font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px;">Net Liability</div>
          <div style="font-size:22px;font-weight:700;color:#059669;">${gbp(data.cis.liability_pounds)}</div>
        </div>
        <div style="background:#fef3c7;border-radius:10px;padding:14px;">
          <div style="font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px;">Deadline</div>
          <div style="font-size:18px;font-weight:700;color:#d97706;">${data.cis.deadline}</div>
          <div style="font-size:11px;color:#9ca3af;">${data.cis.days_until_deadline} days</div>
        </div>
        <div style="background:${data.cis.submitted ? '#f0fdf4' : '#fef2f2'};border-radius:10px;padding:14px;">
          <div style="font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px;">CIS300 Status</div>
          <div style="font-size:16px;font-weight:700;color:${data.cis.submitted ? '#059669' : '#dc2626'};">${data.cis.submitted ? 'Submitted ✓' : 'Not submitted'}</div>
        </div>
      </div>
    </div>
  ` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: Arial, Helvetica, sans-serif; font-size: 13px; color: #374151; background: #fff; }
    @page { size: A4; margin: 0; }
  </style>
</head>
<body>
  <!-- Header -->
  <div style="background:linear-gradient(135deg, #0f172a 0%, #1e293b 100%);padding:28px 32px;display:flex;justify-content:space-between;align-items:center;">
    <div>
      <div style="color:#94a3b8;font-size:11px;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">Business Report</div>
      <div style="color:#fff;font-size:20px;font-weight:700;">${data.company_name}</div>
      <div style="color:#64748b;font-size:12px;margin-top:4px;">${data.period}</div>
    </div>
    <div style="text-align:right;">
      ${logoHtml}
      <div style="color:#64748b;font-size:11px;margin-top:8px;">Generated ${data.generated_at.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</div>
      <div style="color:#475569;font-size:11px;">Powered by Pip · Vantro</div>
    </div>
  </div>

  <div style="padding:28px 32px;">

    <!-- Key Highlights -->
    ${data.highlights.length > 0 ? `
    <div style="background:#eff6ff;border-left:4px solid ${accent};border-radius:0 10px 10px 0;padding:16px 20px;margin-bottom:28px;">
      <h3 style="font-size:13px;font-weight:700;color:${accent};margin-bottom:10px;text-transform:uppercase;letter-spacing:.5px;">Key Highlights</h3>
      <ul style="list-style:disc;padding-left:20px;color:#1e3a5f;font-size:13px;line-height:1.6;">
        ${highlightItems}
      </ul>
    </div>
    ` : ''}

    <!-- Financial Summary -->
    <div style="margin-bottom:28px;">
      <h3 style="font-size:15px;font-weight:700;color:#1f2937;margin:0 0 14px;padding-bottom:8px;border-bottom:2px solid ${accent};">Financial Summary</h3>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;">
        <div style="background:#f8fafc;border-radius:10px;padding:16px;border:1px solid #e2e8f0;">
          <div style="font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px;">Revenue (${data.period})</div>
          <div style="font-size:26px;font-weight:700;color:#1f2937;">${gbp(data.revenue.total_pounds)}</div>
          <div style="font-size:12px;color:${changeColour(data.revenue.change_percent)};margin-top:4px;">${pct(data.revenue.change_percent)} vs previous period</div>
          <div style="font-size:11px;color:#9ca3af;margin-top:2px;">${data.revenue.invoice_count} invoices · avg ${gbp(data.revenue.average_pounds)}</div>
        </div>
        <div style="background:#f8fafc;border-radius:10px;padding:16px;border:1px solid #e2e8f0;">
          <div style="font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px;">Outstanding</div>
          <div style="font-size:26px;font-weight:700;color:#d97706;">${gbp(data.invoices.outstanding_pounds)}</div>
          <div style="font-size:12px;color:#9ca3af;margin-top:4px;">${data.invoices.outstanding_count} invoice${data.invoices.outstanding_count !== 1 ? 's' : ''} awaiting payment</div>
        </div>
        <div style="background:#fef2f2;border-radius:10px;padding:16px;border:1px solid #fecaca;">
          <div style="font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px;">Overdue</div>
          <div style="font-size:26px;font-weight:700;color:#dc2626;">${gbp(data.invoices.overdue_pounds)}</div>
          <div style="font-size:12px;color:#9ca3af;margin-top:4px;">${data.invoices.overdue_count} invoice${data.invoices.overdue_count !== 1 ? 's' : ''} past due date</div>
        </div>
      </div>
    </div>

    <!-- Top Debtors -->
    ${data.debtors.length > 0 ? `
    <div style="margin-bottom:28px;">
      <h3 style="font-size:15px;font-weight:700;color:#1f2937;margin:0 0 14px;padding-bottom:8px;border-bottom:2px solid ${accent};">Customer Debt Aging (Top 5)</h3>
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <thead>
          <tr style="background:#f1f5f9;">
            <th style="padding:10px 12px;text-align:left;font-weight:600;color:#374151;font-size:12px;">Customer</th>
            <th style="padding:10px 12px;text-align:right;font-weight:600;color:#374151;font-size:12px;">Amount Owed</th>
            <th style="padding:10px 12px;text-align:center;font-weight:600;color:#374151;font-size:12px;">Invoices</th>
            <th style="padding:10px 12px;text-align:center;font-weight:600;color:#374151;font-size:12px;">Oldest</th>
          </tr>
        </thead>
        <tbody>${debtorRows}</tbody>
      </table>
    </div>
    ` : ''}

    <!-- Cash Flow + Jobs in 2 columns -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-bottom:28px;">
      <div>
        <h3 style="font-size:15px;font-weight:700;color:#1f2937;margin:0 0 14px;padding-bottom:8px;border-bottom:2px solid ${accent};">30-Day Cash Outlook</h3>
        <div style="background:#f8fafc;border-radius:10px;padding:16px;border:1px solid #e2e8f0;">
          <div style="display:flex;justify-content:space-between;margin-bottom:10px;">
            <span style="color:#6b7280;">Expected income</span>
            <span style="font-weight:600;color:#059669;">${gbp(data.cash_flow.income_pounds)}</span>
          </div>
          <div style="display:flex;justify-content:space-between;margin-bottom:10px;padding-bottom:10px;border-bottom:1px solid #e5e7eb;">
            <span style="color:#6b7280;">Expected expenses</span>
            <span style="font-weight:600;color:#dc2626;">${gbp(data.cash_flow.expenses_pounds)}</span>
          </div>
          <div style="display:flex;justify-content:space-between;">
            <span style="font-weight:700;">Net</span>
            <span style="font-weight:700;font-size:16px;color:${data.cash_flow.net_pounds >= 0 ? '#059669' : '#dc2626'};">${gbp(data.cash_flow.net_pounds)}</span>
          </div>
        </div>
      </div>
      <div>
        <h3 style="font-size:15px;font-weight:700;color:#1f2937;margin:0 0 14px;padding-bottom:8px;border-bottom:2px solid ${accent};">Job Summary</h3>
        <div style="background:#f8fafc;border-radius:10px;padding:16px;border:1px solid #e2e8f0;">
          <div style="display:flex;justify-content:space-between;margin-bottom:10px;">
            <span style="color:#6b7280;">Completed this period</span>
            <span style="font-weight:700;font-size:18px;color:#059669;">${data.jobs.completed}</span>
          </div>
          <div style="display:flex;justify-content:space-between;margin-bottom:10px;">
            <span style="color:#6b7280;">In progress</span>
            <span style="font-weight:700;font-size:18px;color:#d97706;">${data.jobs.in_progress}</span>
          </div>
          <div style="display:flex;justify-content:space-between;">
            <span style="color:#6b7280;">Scheduled</span>
            <span style="font-weight:700;font-size:18px;color:#2563eb;">${data.jobs.scheduled}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Quote Pipeline -->
    <div style="margin-bottom:28px;">
      <h3 style="font-size:15px;font-weight:700;color:#1f2937;margin:0 0 14px;padding-bottom:8px;border-bottom:2px solid ${accent};">Quote Pipeline</h3>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:16px;">
        <div style="background:#f8fafc;border-radius:10px;padding:14px;border:1px solid #e2e8f0;text-align:center;">
          <div style="font-size:11px;color:#6b7280;margin-bottom:4px;">Pipeline Value</div>
          <div style="font-size:20px;font-weight:700;color:#1f2937;">${gbp(data.quotes.pipeline_pounds)}</div>
        </div>
        <div style="background:#f8fafc;border-radius:10px;padding:14px;border:1px solid #e2e8f0;text-align:center;">
          <div style="font-size:11px;color:#6b7280;margin-bottom:4px;">Sent</div>
          <div style="font-size:20px;font-weight:700;color:#1f2937;">${data.quotes.sent_count}</div>
        </div>
        <div style="background:#f8fafc;border-radius:10px;padding:14px;border:1px solid #e2e8f0;text-align:center;">
          <div style="font-size:11px;color:#6b7280;margin-bottom:4px;">Accepted</div>
          <div style="font-size:20px;font-weight:700;color:#059669;">${data.quotes.accepted_count}</div>
        </div>
        <div style="background:#f8fafc;border-radius:10px;padding:14px;border:1px solid #e2e8f0;text-align:center;">
          <div style="font-size:11px;color:#6b7280;margin-bottom:4px;">Conversion Rate</div>
          <div style="font-size:20px;font-weight:700;color:#1f2937;">${data.quotes.conversion_rate !== null ? `${data.quotes.conversion_rate}%` : '—'}</div>
        </div>
      </div>
    </div>

    <!-- CIS Position -->
    ${cisSection}

    <!-- Team Productivity -->
    ${data.team.length > 0 ? `
    <div style="margin-bottom:28px;">
      <h3 style="font-size:15px;font-weight:700;color:#1f2937;margin:0 0 14px;padding-bottom:8px;border-bottom:2px solid ${accent};">Team Productivity</h3>
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <thead>
          <tr style="background:#f1f5f9;">
            <th style="padding:10px 12px;text-align:left;font-weight:600;color:#374151;font-size:12px;">Engineer</th>
            <th style="padding:10px 12px;text-align:center;font-weight:600;color:#374151;font-size:12px;">Hours Logged</th>
            <th style="padding:10px 12px;text-align:center;font-weight:600;color:#374151;font-size:12px;">Jobs Completed</th>
          </tr>
        </thead>
        <tbody>${teamRows}</tbody>
      </table>
    </div>
    ` : ''}

    <!-- Footer -->
    <div style="border-top:1px solid #e5e7eb;padding-top:16px;margin-top:8px;">
      <p style="font-size:11px;color:#9ca3af;line-height:1.5;">
        This report was generated automatically by Pip, your Vantro AI assistant. Revenue figures reflect paid invoices only.
        P&amp;L estimates are based on invoices and purchase orders tracked in Vantro and do not include overhead costs
        (rent, fuel, insurance, wages). Consult your accountant for full statutory accounts.
      </p>
    </div>

  </div>
</body>
</html>`;
}
