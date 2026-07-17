import { emailBrandingFooter } from '../../../common/branding-footer';

export function onMyWayHtml(data: {
  customerName: string;
  companyName: string;
  companyEmail: string;
  companyPhone?: string;
  engineerName: string;
  jobTitle: string;
  logoUrl: string | null;
  brandingFooterEnabled?: boolean;
}): string {
  return `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1a1a1a;">
      <div style="background:#1d4ed8;padding:24px 32px;border-radius:8px 8px 0 0;">
        ${data.logoUrl
          ? `<img src="${data.logoUrl}" alt="${data.companyName}" style="height:36px;object-fit:contain;margin-bottom:8px;display:block;" />`
          : `<h1 style="color:white;margin:0;font-size:20px;">${data.companyName}</h1>`
        }
        <p style="color:rgba(255,255,255,0.8);margin:4px 0 0;font-size:13px;">Engineer on the way</p>
      </div>
      <div style="border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px;padding:32px;">
        <p style="margin:0 0 16px;">Dear ${data.customerName},</p>
        <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;
          padding:16px 20px;margin-bottom:24px;">
          <p style="margin:0;color:#166534;font-size:15px;font-weight:600;">
            &#128663; ${data.engineerName} is on the way to you now.
          </p>
        </div>
        <p style="margin:0 0 20px;color:#555;line-height:1.6;">
          Your engineer for <strong>${data.jobTitle}</strong> is heading to you. Please make
          sure there is access to the property.
        </p>
        ${data.companyPhone ? `
        <p style="margin:0 0 24px;color:#555;">
          If you need to reach us, give us a call:
          <a href="tel:${data.companyPhone}" style="color:#1d4ed8;font-weight:600;">${data.companyPhone}</a>
        </p>` : ''}
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
