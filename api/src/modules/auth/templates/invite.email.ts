export function inviteEmailHtml(inviteUrl: string, companyName: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>You've been invited to Vantro</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f5;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">

          <!-- Header -->
          <tr>
            <td style="background-color:#1d4ed8;padding:32px 40px;">
              <p style="margin:0;font-size:24px;font-weight:700;color:#ffffff;letter-spacing:-0.5px;">Vantro</p>
              <p style="margin:4px 0 0;font-size:13px;color:#93c5fd;">Job management for plumbers &amp; heating engineers</p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:40px 40px 32px;">
              <h1 style="margin:0 0 16px;font-size:22px;font-weight:600;color:#111827;">You've been invited to join ${companyName}</h1>
              <p style="margin:0 0 32px;font-size:15px;line-height:1.6;color:#374151;">
                Your employer has added you to their Vantro account. Click the button below to set your password and get started.
              </p>

              <!-- Button -->
              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td style="border-radius:6px;background-color:#1d4ed8;">
                    <a href="${inviteUrl}"
                       style="display:inline-block;padding:14px 28px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:6px;">
                      Accept invitation
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin:24px 0 0;font-size:13px;color:#6b7280;">
                &#x23F0; This invitation expires in <strong>48 hours</strong>.
              </p>
            </td>
          </tr>

          <!-- Divider -->
          <tr>
            <td style="padding:0 40px;"><hr style="border:none;border-top:1px solid #e5e7eb;" /></td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:24px 40px 32px;">
              <p style="margin:0;font-size:13px;color:#9ca3af;line-height:1.6;">
                If you were not expecting this invitation you can safely ignore this email.
              </p>
              <p style="margin:12px 0 0;font-size:13px;color:#9ca3af;">
                If the button above does not work, copy and paste this link into your browser:
              </p>
              <p style="margin:4px 0 0;font-size:12px;word-break:break-all;">
                <a href="${inviteUrl}" style="color:#1d4ed8;">${inviteUrl}</a>
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
