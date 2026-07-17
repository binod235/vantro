import { emailBrandingFooter } from '../../../common/branding-footer';

export function serviceRenewalHtml(data: {
  customerName: string;
  companyName: string;
  companyEmail: string;
  companyPhone?: string;
  propertyAddress: string;
  certNumber: string;
  expiryDateStr: string;
  daysUntilExpiry: number;
  logoUrl: string | null;
  brandingFooterEnabled?: boolean;
}): string {
  const isUrgent = data.daysUntilExpiry <= 14;
  const accent = isUrgent ? '#dc2626' : '#1d4ed8';

  return `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1a1a1a;">
      <div style="background:${accent};padding:24px 32px;border-radius:8px 8px 0 0;">
        ${data.logoUrl
          ? `<img src="${data.logoUrl}" alt="${data.companyName}" style="height:36px;object-fit:contain;margin-bottom:8px;display:block;" />`
          : `<h1 style="color:white;margin:0;font-size:20px;">${data.companyName}</h1>`
        }
        <p style="color:rgba(255,255,255,0.85);margin:4px 0 0;font-size:13px;">Annual Gas Safety Renewal</p>
      </div>
      <div style="border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px;padding:32px;">
        <p style="margin:0 0 16px;">Dear ${data.customerName},</p>
        <p style="margin:0 0 20px;color:#555;line-height:1.6;">
          Your annual gas safety inspection is due soon. Your Gas Safety Certificate
          (CP12) for <strong>${data.propertyAddress}</strong> expires on
          <strong style="color:${accent};">${data.expiryDateStr}</strong>
          — that's in <strong>${data.daysUntilExpiry} days</strong>.
        </p>
        ${isUrgent ? `
        <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;
          padding:12px 16px;margin-bottom:20px;">
          <p style="margin:0;color:#dc2626;font-size:13px;font-weight:600;">
            Important: Landlords are legally required to hold a valid Gas Safety Certificate at all times.
          </p>
        </div>` : ''}
        <p style="margin:0 0 24px;color:#555;line-height:1.6;">
          Please get in touch to book your annual inspection at a time that suits you.
        </p>
        <table style="width:100%;border-collapse:collapse;background:#f9fafb;border-radius:8px;margin-bottom:24px;">
          <tr>
            <td style="padding:10px 16px;font-size:13px;color:#888;">Certificate No.</td>
            <td style="padding:10px 16px;font-size:13px;font-weight:600;">${data.certNumber}</td>
          </tr>
          <tr style="border-top:1px solid #e5e7eb;">
            <td style="padding:10px 16px;font-size:13px;color:#888;">Property</td>
            <td style="padding:10px 16px;font-size:13px;">${data.propertyAddress}</td>
          </tr>
          <tr style="border-top:1px solid #e5e7eb;">
            <td style="padding:10px 16px;font-size:13px;color:#888;">Expiry Date</td>
            <td style="padding:10px 16px;font-size:13px;font-weight:600;color:${accent};">${data.expiryDateStr}</td>
          </tr>
        </table>
        ${data.companyPhone ? `
        <a href="tel:${data.companyPhone}"
          style="display:inline-block;background:${accent};color:white;padding:12px 24px;
            border-radius:6px;text-decoration:none;font-weight:bold;font-size:14px;margin-bottom:24px;">
          Call Us to Book: ${data.companyPhone}
        </a>` : ''}
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
