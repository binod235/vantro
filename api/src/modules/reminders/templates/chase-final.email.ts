import { emailBrandingFooter } from '../../../common/branding-footer';

export function chaseFinalHtml(data: {
  customerName: string;
  companyName: string;
  companyEmail: string;
  invoiceNumber: string;
  amountDuePence: number;
  dueDateStr: string;
  daysOverdue: number;
  paymentLink: string;
  logoUrl: string | null;
  interestEnabled: boolean;
  isBusiness: boolean;
  interestRatePct: number;
  interestPounds: number | null;
  brandingFooterEnabled?: boolean;
}): string {
  const gbp = (p: number) =>
    new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(p / 100);
  const gbpDecimal = (n: number) =>
    new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', minimumFractionDigits: 2 }).format(n);

  const showInterest = data.interestEnabled && data.isBusiness && data.interestPounds !== null;

  return `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1a1a1a;">
      <div style="background:#dc2626;padding:24px 32px;border-radius:8px 8px 0 0;">
        ${data.logoUrl
          ? `<img src="${data.logoUrl}" alt="${data.companyName}" style="height:36px;object-fit:contain;margin-bottom:8px;display:block;" />`
          : `<h1 style="color:white;margin:0;font-size:20px;">${data.companyName}</h1>`
        }
        <p style="color:rgba(255,255,255,0.85);margin:4px 0 0;font-size:13px;">Final Notice — Invoice ${data.invoiceNumber}</p>
      </div>
      <div style="border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px;padding:32px;">
        <p style="margin:0 0 16px;">Dear ${data.customerName},</p>
        <p style="margin:0 0 16px;color:#555;line-height:1.6;">
          We are writing to advise you that invoice <strong>${data.invoiceNumber}</strong>
          for <strong>${gbp(data.amountDuePence)}</strong>, due on ${data.dueDateStr},
          remains unpaid after <strong style="color:#dc2626;">${data.daysOverdue} day${data.daysOverdue !== 1 ? 's' : ''}</strong>.
          Despite previous reminders, we have not yet received payment.
        </p>

        ${showInterest ? `
        <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:16px;margin:0 0 20px;">
          <p style="margin:0 0 8px;font-size:13px;font-weight:600;color:#dc2626;">Statutory Interest Notice</p>
          <p style="margin:0;font-size:13px;color:#555;line-height:1.6;">
            Under the <em>Late Payment of Commercial Debts (Interest) Act 1998</em>, this invoice
            may accrue statutory interest at <strong>${data.interestRatePct}% per annum</strong>.
            Interest accrued to date: <strong>${gbpDecimal(data.interestPounds!)}</strong>.
          </p>
        </div>
        ` : ''}

        <p style="margin:0 0 24px;color:#555;line-height:1.6;">
          Please arrange payment in full immediately, or contact us to discuss the matter.
          Failure to do so may result in us referring this debt for further recovery action.
        </p>
        <a href="${data.paymentLink}"
          style="display:inline-block;background:#dc2626;color:white;padding:14px 28px;border-radius:6px;text-decoration:none;font-weight:bold;font-size:15px;margin-bottom:24px;">
          Pay Now &rarr;
        </a>
        <table style="width:100%;border-collapse:collapse;background:#fef2f2;border-radius:8px;margin-bottom:24px;border:1px solid #fecaca;">
          <tr>
            <td style="padding:10px 16px;font-size:13px;color:#888;">Invoice</td>
            <td style="padding:10px 16px;font-size:13px;font-weight:600;">${data.invoiceNumber}</td>
          </tr>
          <tr style="border-top:1px solid #fecaca;">
            <td style="padding:10px 16px;font-size:13px;color:#888;">Amount Due</td>
            <td style="padding:10px 16px;font-size:15px;font-weight:700;color:#dc2626;">${gbp(data.amountDuePence)}</td>
          </tr>
          <tr style="border-top:1px solid #fecaca;">
            <td style="padding:10px 16px;font-size:13px;color:#888;">Original Due Date</td>
            <td style="padding:10px 16px;font-size:13px;">${data.dueDateStr}</td>
          </tr>
          <tr style="border-top:1px solid #fecaca;">
            <td style="padding:10px 16px;font-size:13px;color:#888;">Days Overdue</td>
            <td style="padding:10px 16px;font-size:13px;font-weight:600;color:#dc2626;">${data.daysOverdue} day${data.daysOverdue !== 1 ? 's' : ''}</td>
          </tr>
          ${showInterest ? `
          <tr style="border-top:1px solid #fecaca;">
            <td style="padding:10px 16px;font-size:13px;color:#888;">Interest Accrued</td>
            <td style="padding:10px 16px;font-size:13px;color:#dc2626;">${gbpDecimal(data.interestPounds!)}</td>
          </tr>
          ` : ''}
        </table>
        <p style="margin:0;font-size:13px;color:#555;">
          Yours faithfully,<br>
          <strong>${data.companyName}</strong><br>
          <a href="mailto:${data.companyEmail}" style="color:#dc2626;">${data.companyEmail}</a>
        </p>
        ${emailBrandingFooter(data.brandingFooterEnabled ?? true)}
      </div>
    </div>
  `;
}
