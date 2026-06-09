export function trialReminderEmailHtml(ownerName: string, daysLeft: number, subscribeUrl: string): string {
  const urgentColour = daysLeft <= 1 ? '#dc2626' : '#d97706';
  const subject = daysLeft <= 1
    ? 'Your Vantro trial ends tomorrow'
    : `Your Vantro trial ends in ${daysLeft} days`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${subject}</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f5;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">

          <!-- Header -->
          <tr>
            <td style="background-color:${urgentColour};padding:32px 40px;">
              <p style="margin:0;font-size:24px;font-weight:700;color:#ffffff;letter-spacing:-0.5px;">Vantro</p>
              <p style="margin:4px 0 0;font-size:13px;color:rgba(255,255,255,0.8);">Job management for plumbers &amp; heating engineers</p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:40px 40px 32px;">
              <h1 style="margin:0 0 16px;font-size:22px;font-weight:600;color:#111827;">
                ${daysLeft <= 1 ? 'Your trial ends tomorrow' : `Your trial ends in ${daysLeft} days`}
              </h1>
              <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#374151;">
                Hi ${ownerName},
              </p>
              <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#374151;">
                ${daysLeft <= 1
                  ? 'Your Vantro free trial ends tomorrow. After that, your account will become read-only — you can still view all your jobs, customers, and data, but you won\'t be able to create or edit anything until you subscribe.'
                  : `Your Vantro free trial ends in ${daysLeft} days. Subscribe before then to keep full access to your jobs, timesheets, customers, and team.`
                }
              </p>
              <p style="margin:0 0 32px;font-size:15px;line-height:1.6;color:#374151;">
                Vantro costs <strong>£59/month</strong> — flat rate, no per-user fees, cancel any time.
              </p>

              <!-- CTA -->
              <table cellpadding="0" cellspacing="0" style="margin:0 0 32px;">
                <tr>
                  <td style="background-color:${urgentColour};border-radius:6px;padding:14px 28px;">
                    <a href="${subscribeUrl}" style="font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;">
                      Subscribe now — £59/month
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin:0 0 8px;font-size:13px;color:#6b7280;">
                Your existing data is safe and will always remain accessible.
              </p>
              <p style="margin:0;font-size:13px;color:#6b7280;">
                If you have any questions, reply to this email and we'll help.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color:#f9fafb;padding:20px 40px;border-top:1px solid #e5e7eb;">
              <p style="margin:0;font-size:12px;color:#9ca3af;text-align:center;">
                Vantro · Built for UK plumbing &amp; heating firms
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export function trialReminderSubject(daysLeft: number): string {
  return daysLeft <= 1
    ? 'Your Vantro trial ends tomorrow — subscribe to keep full access'
    : `Your Vantro trial ends in ${daysLeft} days`;
}
