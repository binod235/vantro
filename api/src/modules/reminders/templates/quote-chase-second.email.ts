import { emailBrandingFooter } from '../../../common/branding-footer';

export function quoteChaseSecondHtml(data: {
  customerName: string;
  companyName: string;
  companyEmail: string;
  quoteNumber: string;
  totalPence: number;
  expiryDateStr: string | null;
  acceptanceLink: string;
  logoUrl: string | null;
  brandingFooterEnabled?: boolean;
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
        <p style="color:rgba(255,255,255,0.8);margin:4px 0 0;font-size:13px;">Quote Reminder</p>
      </div>
      <div style="border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px;padding:32px;">
        <p style="margin:0 0 16px;">Dear ${data.customerName},</p>
        <p style="margin:0 0 20px;color:#555;line-height:1.6;">
          We're following up again on quote <strong>${data.quoteNumber}</strong>
          (${gbp(data.totalPence)}).
          We'd love the opportunity to do this work for you — if now isn't the right time,
          or if you'd like to adjust anything, just let us know and we're happy to help.
        </p>
        <a href="${data.acceptanceLink}"
          style="display:inline-block;background:#1d4ed8;color:white;padding:14px 28px;
            border-radius:6px;text-decoration:none;font-weight:bold;font-size:15px;margin-bottom:24px;">
          View &amp; Accept Quote &rarr;
        </a>
        <table style="width:100%;border-collapse:collapse;background:#f9fafb;border-radius:8px;margin-bottom:24px;">
          <tr>
            <td style="padding:10px 16px;font-size:13px;color:#888;">Quote</td>
            <td style="padding:10px 16px;font-size:13px;font-weight:600;">${data.quoteNumber}</td>
          </tr>
          <tr style="border-top:1px solid #e5e7eb;">
            <td style="padding:10px 16px;font-size:13px;color:#888;">Total</td>
            <td style="padding:10px 16px;font-size:15px;font-weight:700;color:#1d4ed8;">${gbp(data.totalPence)}</td>
          </tr>
          ${data.expiryDateStr ? `
          <tr style="border-top:1px solid #e5e7eb;">
            <td style="padding:10px 16px;font-size:13px;color:#888;">Valid Until</td>
            <td style="padding:10px 16px;font-size:13px;">${data.expiryDateStr}</td>
          </tr>` : ''}
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
