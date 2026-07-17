import { emailBrandingFooter } from '../../../common/branding-footer';

export function reviewRequestHtml(data: {
  customerName: string;
  companyName: string;
  companyEmail: string;
  invoiceNumber: string;
  reviewUrl: string;
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
        <p style="color:rgba(255,255,255,0.8);margin:4px 0 0;font-size:13px;">Thank You</p>
      </div>
      <div style="border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px;padding:32px;">
        <p style="margin:0 0 16px;">Dear ${data.customerName},</p>
        <p style="margin:0 0 20px;color:#555;line-height:1.6;">
          Thank you for settling invoice <strong>${data.invoiceNumber}</strong>. We really appreciate
          your business and hope the work met your expectations.
        </p>
        <p style="margin:0 0 24px;color:#555;line-height:1.6;">
          If you're happy with the service we provided, it would mean the world to us if you could
          leave a quick review — it only takes a minute and helps other customers find us.
        </p>
        <a href="${data.reviewUrl}"
          style="display:inline-block;background:#f59e0b;color:white;padding:14px 28px;
            border-radius:6px;text-decoration:none;font-weight:bold;font-size:15px;margin-bottom:24px;">
          &#11088; Leave a Google Review
        </a>
        <p style="margin:0;font-size:13px;color:#555;">
          Many thanks,<br>
          <strong>${data.companyName}</strong><br>
          <a href="mailto:${data.companyEmail}" style="color:#1d4ed8;">${data.companyEmail}</a>
        </p>
        ${emailBrandingFooter(data.brandingFooterEnabled ?? true)}
      </div>
    </div>
  `;
}
