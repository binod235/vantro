import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

const SANDBOX      = process.env.HMRC_SANDBOX_URL ?? 'https://test-api.service.hmrc.gov.uk';
const CLIENT_ID    = process.env.HMRC_CLIENT_ID     ?? '';
const CLIENT_SECRET = process.env.HMRC_CLIENT_SECRET ?? '';
const REDIRECT_URI = process.env.HMRC_REDIRECT_URI  ?? '';

// Fraud prevention headers — legally required by HMRC, never remove
const FRAUD_HEADERS = {
  'Gov-Client-Connection-Method': 'WEB_APP_VIA_SERVER',
  'Gov-Client-Timezone':          'UTC+00:00',
  'Gov-Vendor-Version':           'vantro=1.0.0',
  'Gov-Client-User-IDs':          'vantro=owner',
};

@Injectable()
export class HmrcService {
  private readonly logger = new Logger(HmrcService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ── Step 1: Generate OAuth authorization URL ─────────────────────────────

  getAuthorizationUrl(companyId: string): string {
    const params = new URLSearchParams({
      response_type: 'code',
      client_id:     CLIENT_ID,
      scope:         'write:self-assessment read:self-assessment',
      redirect_uri:  REDIRECT_URI,
      state:         companyId,
    });
    return `${SANDBOX}/oauth/authorize?${params.toString()}`;
  }

  // ── Step 2: Exchange auth code for tokens ────────────────────────────────

  async exchangeCodeForTokens(companyId: string, code: string): Promise<void> {
    const res = await fetch(`${SANDBOX}/oauth/token`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    new URLSearchParams({
        grant_type:    'authorization_code',
        code,
        client_id:     CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri:  REDIRECT_URI,
      }).toString(),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`HMRC token exchange failed: ${err}`);
    }

    const data = await res.json() as {
      access_token:  string;
      refresh_token: string;
      expires_in:    number;
      token_type:    string;
    };

    const expiresAt = new Date(Date.now() + data.expires_in * 1000);

    await this.prisma.client.company.update({
      where: { id: companyId },
      data: {
        hmrc_access_token:     data.access_token,
        hmrc_refresh_token:    data.refresh_token,
        hmrc_token_expires_at: expiresAt,
        hmrc_connected:        true,
        hmrc_connected_at:     new Date(),
      },
    });

    this.logger.log(`HMRC connected for company ${companyId}`);
  }

  // ── Step 3: Refresh access token when expired ────────────────────────────

  async refreshTokenIfNeeded(companyId: string): Promise<string> {
    const company = await this.prisma.client.company.findUnique({
      where:  { id: companyId },
      select: {
        hmrc_access_token:     true,
        hmrc_refresh_token:    true,
        hmrc_token_expires_at: true,
        hmrc_connected:        true,
      },
    });

    if (!company?.hmrc_connected || !company.hmrc_access_token) {
      throw new UnauthorizedException(
        'HMRC account not connected. Please connect in Settings.',
      );
    }

    // Token still valid (with 5 min buffer)
    const expiresAt = company.hmrc_token_expires_at;
    if (expiresAt && expiresAt.getTime() > Date.now() + 5 * 60 * 1000) {
      return company.hmrc_access_token;
    }

    if (!company.hmrc_refresh_token) {
      throw new UnauthorizedException(
        'HMRC session expired. Please reconnect in Settings.',
      );
    }

    const res = await fetch(`${SANDBOX}/oauth/token`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    new URLSearchParams({
        grant_type:    'refresh_token',
        refresh_token: company.hmrc_refresh_token,
        client_id:     CLIENT_ID,
        client_secret: CLIENT_SECRET,
      }).toString(),
    });

    if (!res.ok) {
      await this.prisma.client.company.update({
        where: { id: companyId },
        data:  { hmrc_connected: false },
      });
      throw new UnauthorizedException(
        'HMRC session expired. Please reconnect in Settings.',
      );
    }

    const data = await res.json() as {
      access_token:  string;
      refresh_token: string;
      expires_in:    number;
    };

    const expiresAtNew = new Date(Date.now() + data.expires_in * 1000);

    await this.prisma.client.company.update({
      where: { id: companyId },
      data: {
        hmrc_access_token:     data.access_token,
        hmrc_refresh_token:    data.refresh_token,
        hmrc_token_expires_at: expiresAtNew,
      },
    });

    return data.access_token;
  }

  // ── Disconnect HMRC ───────────────────────────────────────────────────────

  async disconnect(companyId: string): Promise<void> {
    await this.prisma.client.company.update({
      where: { id: companyId },
      data: {
        hmrc_access_token:     null,
        hmrc_refresh_token:    null,
        hmrc_token_expires_at: null,
        hmrc_connected:        false,
      },
    });
  }

  // ── Get connection status ─────────────────────────────────────────────────

  async getStatus(companyId: string) {
    const company = await this.prisma.client.company.findUnique({
      where:  { id: companyId },
      select: {
        hmrc_connected:    true,
        hmrc_connected_at: true,
        hmrc_nino:         true,
      },
    });
    return {
      connected:   company?.hmrc_connected    ?? false,
      connectedAt: company?.hmrc_connected_at ?? null,
      hasNino:     !!company?.hmrc_nino,
    };
  }

  // ── Update company NINO ───────────────────────────────────────────────────

  async updateNino(companyId: string, nino: string): Promise<void> {
    await this.prisma.client.company.update({
      where: { id: companyId },
      data:  { hmrc_nino: nino },
    });
  }

  // ── Submit suffered deduction to HMRC ─────────────────────────────────────
  // Uses CIS Deductions MTD API 3.0
  // The plumbing firm acts as subcontractor — records CIS deducted from them

  async submitSufferedDeduction(
    companyId:   string,
    deductionId: string,
  ): Promise<{ submissionId: string }> {
    const company = await this.prisma.client.company.findUnique({
      where:  { id: companyId },
      select: { hmrc_nino: true, hmrc_connected: true },
    });

    if (!company?.hmrc_nino) {
      throw new Error(
        'NI number not set. Add your company NI number in Settings → HMRC.',
      );
    }

    const deduction = await this.prisma.client.cisSufferedDeduction.findFirst({
      where: { id: deductionId, company_id: companyId },
    });
    if (!deduction) throw new Error('Deduction not found');

    const accessToken = await this.refreshTokenIfNeeded(companyId);
    const taxYear     = this.formatTaxYear(deduction.tax_month);

    const payload = {
      fromDate:         this.taxMonthToFromDate(deduction.tax_month),
      toDate:           this.taxMonthToToDate(deduction.tax_month),
      contractorName:   deduction.contractor_name,
      contractorRef:    deduction.contractor_utr ?? 'UNKNOWN',
      grossAmountPaid:  deduction.gross_amount_pence / 100,
      deductionAmount:  deduction.deduction_amount_pence / 100,
      costOfMaterials:  0,
    };

    const nino = company.hmrc_nino;
    const url  = `${SANDBOX}/individuals/deductions/cis/${nino}/amendments`;

    const res = await fetch(url, {
      method:  'POST',
      headers: {
        Authorization:   `Bearer ${accessToken}`,
        Accept:          'application/vnd.hmrc.3.0+json',
        'Content-Type':  'application/json',
        ...FRAUD_HEADERS,
      },
      body: JSON.stringify({ taxYear, deductions: [payload] }),
    });

    if (!res.ok) {
      const err = await res.text();
      this.logger.error(`HMRC CIS submission failed: ${err}`);
      let message: string;
      try {
        message = (JSON.parse(err) as { message?: string }).message ?? err;
      } catch {
        message = err;
      }
      throw new Error(`HMRC submission failed: ${message}`);
    }

    const result = await res.json() as { submissionId: string };
    this.logger.log(`HMRC CIS deduction submitted: ${result.submissionId} for company ${companyId}`);
    return { submissionId: result.submissionId };
  }

  // ── Retrieve suffered deductions from HMRC ────────────────────────────────

  async retrieveSufferedDeductions(companyId: string, taxYear: string) {
    const company = await this.prisma.client.company.findUnique({
      where:  { id: companyId },
      select: { hmrc_nino: true },
    });
    if (!company?.hmrc_nino) throw new Error('NI number not set');

    const accessToken = await this.refreshTokenIfNeeded(companyId);
    const nino = company.hmrc_nino;

    const url = `${SANDBOX}/individuals/deductions/cis/${nino}/current-position?taxYear=${taxYear}&source=all`;

    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept:        'application/vnd.hmrc.3.0+json',
        ...FRAUD_HEADERS,
      },
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`HMRC retrieval failed: ${err}`);
    }

    return res.json();
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private formatTaxYear(taxMonth: string): string {
    const [yearStr, monthStr] = taxMonth.split('-');
    const year  = parseInt(yearStr!);
    const month = parseInt(monthStr!);
    // Jan-Mar belongs to tax year that started previous April
    if (month <= 3) {
      return `${year - 1}-${String(year).slice(-2)}`;
    }
    return `${year}-${String(year + 1).slice(-2)}`;
  }

  private taxMonthToFromDate(taxMonth: string): string {
    return `${taxMonth}-06`;
  }

  private taxMonthToToDate(taxMonth: string): string {
    const [yearStr, monthStr] = taxMonth.split('-');
    const year      = parseInt(yearStr!);
    const month     = parseInt(monthStr!);
    const nextMonth = month === 12 ? 1 : month + 1;
    const nextYear  = month === 12 ? year + 1 : year;
    return `${nextYear}-${String(nextMonth).padStart(2, '0')}-05`;
  }
}
