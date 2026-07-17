import { emailBrandingFooter } from '../../../common/branding-footer';

export function chaseFirmHtml(data: {
  customerName: string;
  companyName: string;
  companyEmail: string;
  invoiceNumber: string;
  amountDuePence: number;
  dueDateStr: string;
  daysOverdue: number;
  paymentLink: string;
  logoUrl: string | null;
  brandingFooterEnabled?: boolean;
  qrDataUri?: string | null;
}): string {
  const gbp = (p: number) =>
    new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(p / 100);

  return `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1a1a1a;">
      <div style="background:#d97706;padding:24px 32px;border-radius:8px 8px 0 0;">
        ${data.logoUrl
          ? `<img src="${data.logoUrl}" alt="${data.companyName}" style="height:36px;object-fit:contain;margin-bottom:8px;display:block;" />`
          : `<h1 style="color:white;margin:0;font-size:20px;">${data.companyName}</h1>`
        }
        <p style="color:rgba(255,255,255,0.85);margin:4px 0 0;font-size:13px;">Overdue Invoice — Action Required</p>
      </div>
      <div style="border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px;padding:32px;">
        <p style="margin:0 0 16px;">Dear ${data.customerName},</p>
        <p style="margin:0 0 16px;color:#555;line-height:1.6;">
          We're writing to let you know that invoice <strong>${data.invoiceNumber}</strong>
          for <strong>${gbp(data.amountDuePence)}</strong> is now
          <strong style="color:#d97706;">${data.daysOverdue} day${data.daysOverdue !== 1 ? 's' : ''} overdue</strong>.
        </p>
        <p style="margin:0 0 24px;color:#555;line-height:1.6;">
          We would be grateful if you could arrange payment or contact us within the next few days
          to discuss. If you've already paid, please let us know and we'll update our records immediately.
        </p>
        <a href="${data.paymentLink}"
          style="display:inline-block;background:#d97706;color:white;padding:14px 28px;border-radius:6px;text-decoration:none;font-weight:bold;font-size:15px;margin-bottom:24px;">
          Pay Now &rarr;
        </a>
        ${data.qrDataUri ? `<div style="margin:16px 0;text-align:center;"><img src="${data.qrDataUri}" width="100" height="100" alt="Scan to pay" style="display:inline-block;" /><p style="margin:4px 0 0;font-size:11px;color:#9ca3af;">Scan to pay</p></div>` : ''}
        <table style="width:100%;border-collapse:collapse;background:#fffbeb;border-radius:8px;margin-bottom:24px;border:1px solid #fde68a;">
          <tr>
            <td style="padding:10px 16px;font-size:13px;color:#888;">Invoice</td>
            <td style="padding:10px 16px;font-size:13px;font-weight:600;">${data.invoiceNumber}</td>
          </tr>
          <tr style="border-top:1px solid #fde68a;">
            <td style="padding:10px 16px;font-size:13px;color:#888;">Amount Due</td>
            <td style="padding:10px 16px;font-size:15px;font-weight:700;color:#d97706;">${gbp(data.amountDuePence)}</td>
          </tr>
          <tr style="border-top:1px solid #fde68a;">
            <td style="padding:10px 16px;font-size:13px;color:#888;">Original Due Date</td>
            <td style="padding:10px 16px;font-size:13px;">${data.dueDateStr}</td>
          </tr>
          <tr style="border-top:1px solid #fde68a;">
            <td style="padding:10px 16px;font-size:13px;color:#888;">Days Overdue</td>
            <td style="padding:10px 16px;font-size:13px;font-weight:600;color:#d97706;">${data.daysOverdue} day${data.daysOverdue !== 1 ? 's' : ''}</td>
          </tr>
        </table>
        <p style="margin:0;font-size:13px;color:#555;">
          Yours sincerely,<br>
          <strong>${data.companyName}</strong><br>
          <a href="mailto:${data.companyEmail}" style="color:#d97706;">${data.companyEmail}</a>
        </p>
        ${emailBrandingFooter(data.brandingFooterEnabled ?? true)}
      </div>
    </div>
  `;
}
