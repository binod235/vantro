import { emailBrandingFooter } from '../../../common/branding-footer';

export function chaseGentleHtml(data: {
  customerName: string;
  companyName: string;
  companyEmail: string;
  invoiceNumber: string;
  amountDuePence: number;
  dueDateStr: string;
  paymentLink: string;
  logoUrl: string | null;
  brandingFooterEnabled?: boolean;
  qrDataUri?: string | null;
}): string {
  const gbp = (p: number) =>
    new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(p / 100);

  return `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1a1a1a;">
      <div style="background:#1d4ed8;padding:24px 32px;border-radius:8px 8px 0 0;">
        ${data.logoUrl
          ? `<img src="${data.logoUrl}" alt="${data.companyName}" style="height:36px;object-fit:contain;margin-bottom:8px;display:block;" />`
          : `<h1 style="color:white;margin:0;font-size:20px;">${data.companyName}</h1>`
        }
        <p style="color:rgba(255,255,255,0.8);margin:4px 0 0;font-size:13px;">Invoice Reminder</p>
      </div>
      <div style="border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px;padding:32px;">
        <p style="margin:0 0 16px;">Dear ${data.customerName},</p>
        <p style="margin:0 0 20px;color:#555;line-height:1.6;">
          Just a friendly reminder that invoice <strong>${data.invoiceNumber}</strong>
          for <strong>${gbp(data.amountDuePence)}</strong> was due on ${data.dueDateStr}.
          If you've already taken care of this, please ignore this message — and thank you!
        </p>
        <p style="margin:0 0 24px;color:#555;line-height:1.6;">
          If you have any questions about this invoice, please don't hesitate to get in touch.
        </p>
        <a href="${data.paymentLink}"
          style="display:inline-block;background:#1d4ed8;color:white;padding:14px 28px;border-radius:6px;text-decoration:none;font-weight:bold;font-size:15px;margin-bottom:24px;">
          View &amp; Pay Invoice &rarr;
        </a>
        ${data.qrDataUri ? `<div style="margin:16px 0;text-align:center;"><img src="${data.qrDataUri}" width="100" height="100" alt="Scan to pay" style="display:inline-block;" /><p style="margin:4px 0 0;font-size:11px;color:#9ca3af;">Scan to pay</p></div>` : ''}
        <table style="width:100%;border-collapse:collapse;background:#f9fafb;border-radius:8px;margin-bottom:24px;">
          <tr>
            <td style="padding:10px 16px;font-size:13px;color:#888;">Invoice</td>
            <td style="padding:10px 16px;font-size:13px;font-weight:600;">${data.invoiceNumber}</td>
          </tr>
          <tr style="border-top:1px solid #e5e7eb;">
            <td style="padding:10px 16px;font-size:13px;color:#888;">Amount</td>
            <td style="padding:10px 16px;font-size:15px;font-weight:700;color:#1d4ed8;">${gbp(data.amountDuePence)}</td>
          </tr>
          <tr style="border-top:1px solid #e5e7eb;">
            <td style="padding:10px 16px;font-size:13px;color:#888;">Due</td>
            <td style="padding:10px 16px;font-size:13px;">${data.dueDateStr}</td>
          </tr>
        </table>
        <p style="margin:0;font-size:13px;color:#555;">
          Kind regards,<br>
          <strong>${data.companyName}</strong><br>
          <a href="mailto:${data.companyEmail}" style="color:#1d4ed8;">${data.companyEmail}</a>
        </p>
        ${emailBrandingFooter(data.brandingFooterEnabled ?? true)}
      </div>
    </div>
  `;
}
