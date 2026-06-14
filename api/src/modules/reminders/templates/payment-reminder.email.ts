export function paymentReminderHtml(data: {
  customerName: string;
  companyName: string;
  invoiceNumber: string;
  totalPence: number;
  dueDateStr: string;
  daysOverdue: number;
}): string {
  const gbp = (p: number) =>
    new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(p / 100);

  const isOverdue   = data.daysOverdue > 0;
  const accentColor = isOverdue ? '#dc2626' : '#1d4ed8';
  const subject     = isOverdue
    ? `Payment overdue by ${data.daysOverdue} day${data.daysOverdue !== 1 ? 's' : ''}`
    : 'Payment due today';

  return `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1a1a1a;">
      <div style="background:${accentColor};padding:24px 32px;border-radius:8px 8px 0 0;">
        <h1 style="color:white;margin:0;font-size:20px;">${data.companyName}</h1>
        <p style="color:rgba(255,255,255,0.85);margin:4px 0 0;font-size:14px;">
          ${subject}
        </p>
      </div>
      <div style="border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px;padding:32px;">
        <p style="margin:0 0 16px;">Dear ${data.customerName},</p>
        <p style="margin:0 0 24px;color:#555;">
          ${isOverdue
            ? `This is a reminder that invoice <strong>${data.invoiceNumber}</strong> was due on ${data.dueDateStr} and is now <strong style="color:#dc2626;">${data.daysOverdue} day${data.daysOverdue !== 1 ? 's' : ''} overdue</strong>.`
            : `This is a reminder that invoice <strong>${data.invoiceNumber}</strong> is due today, ${data.dueDateStr}.`
          }
        </p>
        <table style="width:100%;border-collapse:collapse;background:#f9fafb;border-radius:8px;margin-bottom:24px;">
          <tr>
            <td style="padding:12px 16px;font-size:13px;color:#888;">Invoice</td>
            <td style="padding:12px 16px;font-size:13px;font-weight:600;">${data.invoiceNumber}</td>
          </tr>
          <tr style="border-top:1px solid #e5e7eb;">
            <td style="padding:12px 16px;font-size:13px;color:#888;">Amount Due</td>
            <td style="padding:12px 16px;font-size:16px;font-weight:700;color:${accentColor};">
              ${gbp(data.totalPence)}
            </td>
          </tr>
          <tr style="border-top:1px solid #e5e7eb;">
            <td style="padding:12px 16px;font-size:13px;color:#888;">Due Date</td>
            <td style="padding:12px 16px;font-size:13px;">${data.dueDateStr}</td>
          </tr>
        </table>
        <p style="margin:0 0 8px;font-size:13px;color:#888;">
          Please arrange payment at your earliest convenience.
          If you have already paid, please disregard this reminder.
        </p>
        <p style="margin:24px 0 0;font-size:13px;color:#888;">
          Kind regards,<br>
          <strong>${data.companyName}</strong>
        </p>
      </div>
    </div>
  `;
}
