/** Returns a small "Sent with Vantro" HTML snippet for outbound customer emails. */
export function emailBrandingFooter(enabled: boolean): string {
  if (!enabled) return '';
  return `
    <hr style="border:none;border-top:1px solid #f0f0f0;margin:20px 0 12px;" />
    <p style="margin:0;font-size:11px;color:#bbb;text-align:center;">
      Sent with <a href="https://vantro.co.uk" style="color:#bbb;text-decoration:none;">Vantro</a>
    </p>`;
}

/** Returns a fixed-position footer string for Puppeteer PDF footers. */
export function pdfBrandingFooter(enabled: boolean): string {
  if (!enabled) return '';
  return `<div style="position:fixed;bottom:6mm;left:0;right:0;text-align:center;font-size:7pt;color:#ccc;font-family:Arial,sans-serif;">
    Sent with <a href="https://vantro.co.uk" style="color:#ccc;text-decoration:none;">Vantro</a>
  </div>`;
}
