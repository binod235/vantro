import * as QRCode from 'qrcode';

/** Returns a data-URI PNG QR code for the given URL, or null on error. */
export async function generateQrDataUri(url: string): Promise<string | null> {
  try {
    return await QRCode.toDataURL(url, {
      errorCorrectionLevel: 'M',
      width: 120,
      margin: 1,
    });
  } catch {
    return null;
  }
}
