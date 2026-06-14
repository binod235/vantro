export function cp12RenewalHtml(data: {
  customerName: string;
  companyName: string;
  companyPhone?: string;
  propertyAddress: string;
  expiryDateStr: string;
  daysUntilExpiry: number;
  certNumber: string;
}): string {
  const isUrgent    = data.daysUntilExpiry <= 14;
  const accentColor = isUrgent ? '#dc2626' : '#1d4ed8';

  return `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1a1a1a;">
      <div style="background:${accentColor};padding:24px 32px;border-radius:8px 8px 0 0;">
        <h1 style="color:white;margin:0;font-size:20px;">${data.companyName}</h1>
        <p style="color:rgba(255,255,255,0.85);margin:4px 0 0;font-size:14px;">
          Gas Safety Certificate Renewal Reminder
        </p>
      </div>
      <div style="border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px;padding:32px;">
        <p style="margin:0 0 16px;">Dear ${data.customerName},</p>
        <p style="margin:0 0 24px;color:#555;">
          Your Gas Safety Certificate (CP12) for <strong>${data.propertyAddress}</strong> is due to
          expire on <strong style="color:${accentColor};">${data.expiryDateStr}</strong>
          — in <strong>${data.daysUntilExpiry} days</strong>.
        </p>
        ${isUrgent ? `
        <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;
          padding:12px 16px;margin-bottom:24px;">
          <p style="margin:0;color:#dc2626;font-size:13px;font-weight:600;">
            Urgent: Landlords are legally required to hold a valid Gas Safety
            Certificate at all times. Failure to renew is a criminal offence.
          </p>
        </div>` : ''}
        <table style="width:100%;border-collapse:collapse;background:#f9fafb;border-radius:8px;margin-bottom:24px;">
          <tr>
            <td style="padding:12px 16px;font-size:13px;color:#888;">Certificate No.</td>
            <td style="padding:12px 16px;font-size:13px;font-weight:600;">${data.certNumber}</td>
          </tr>
          <tr style="border-top:1px solid #e5e7eb;">
            <td style="padding:12px 16px;font-size:13px;color:#888;">Property</td>
            <td style="padding:12px 16px;font-size:13px;">${data.propertyAddress}</td>
          </tr>
          <tr style="border-top:1px solid #e5e7eb;">
            <td style="padding:12px 16px;font-size:13px;color:#888;">Expiry Date</td>
            <td style="padding:12px 16px;font-size:13px;color:${accentColor};font-weight:600;">
              ${data.expiryDateStr}
            </td>
          </tr>
        </table>
        <p style="margin:0 0 16px;color:#555;">
          Please contact us to book your annual gas safety inspection.
        </p>
        ${data.companyPhone ? `
        <p style="margin:0 0 24px;">
          <a href="tel:${data.companyPhone}"
            style="display:inline-block;background:${accentColor};color:white;
              padding:12px 24px;border-radius:6px;text-decoration:none;
              font-weight:bold;font-size:14px;">
            Call Us: ${data.companyPhone}
          </a>
        </p>` : ''}
        <p style="margin:24px 0 0;font-size:13px;color:#888;">
          Kind regards,<br>
          <strong>${data.companyName}</strong>
        </p>
      </div>
    </div>
  `;
}
