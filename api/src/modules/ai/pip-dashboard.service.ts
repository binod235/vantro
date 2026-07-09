import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { InvoiceStatus } from '@prisma/client';

@Injectable()
export class PipDashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getDashboardData(companyId: string) {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayEnd   = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);
    const weekStart  = new Date(todayStart);
    weekStart.setDate(weekStart.getDate() - (weekStart.getDay() === 0 ? 6 : weekStart.getDay() - 1));
    const weekEnd       = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000);
    const monthStart    = new Date(now.getFullYear(), now.getMonth(), 1);
    const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);

    const [
      overdueInvoices,
      unbilledJobs,
      todaysJobs,
      thisWeekJobCount,
      paidThisMonth,
      paidLastMonth,
      paidThisWeek,
      outstandingInvoices,
      pendingQuotes,
      acceptedQuotes,
      rejectedQuotes,
      timesheetsThisWeek,
      overdueTodos,
      dueTodayTodos,
      cisData,
      recentActivity,
      companyData,
      autopilotEvents,
      chasePolicy,
    ] = await Promise.all([
      // 1. Overdue invoices (past due_date, still unpaid/part-paid)
      this.prisma.client.invoice.findMany({
        where: {
          company_id: companyId,
          status: { in: [InvoiceStatus.SENT, InvoiceStatus.PART_PAID] },
          due_date: { lt: now },
        },
        include: { customer: { select: { name: true, phone: true } } },
        orderBy: { due_date: 'asc' },
        take: 10,
      }),

      // 2. Unbilled completed jobs
      this.prisma.client.job.findMany({
        where: {
          company_id: companyId,
          status: 'COMPLETED',
          invoices: { none: { status: { not: InvoiceStatus.CANCELLED } } },
        },
        include: {
          customer: { select: { name: true } },
          quotes: { select: { total_pence: true }, orderBy: { created_at: 'desc' }, take: 1 },
        },
        take: 10,
      }),

      // 3. Today's jobs with customer address for display
      this.prisma.client.job.findMany({
        where: {
          company_id: companyId,
          scheduled_at: { gte: todayStart, lt: todayEnd },
          status: { in: ['SCHEDULED', 'IN_PROGRESS'] },
        },
        include: {
          customer: { select: { name: true, address_line1: true, postcode: true } },
          engineer: { select: { name: true, calendar_colour: true } },
        },
        orderBy: { scheduled_at: 'asc' },
      }),

      // 4. This week job count
      this.prisma.client.job.count({
        where: { company_id: companyId, scheduled_at: { gte: weekStart, lt: weekEnd } },
      }),

      // 5. Revenue collected this month
      this.prisma.client.invoice.aggregate({
        where: { company_id: companyId, status: InvoiceStatus.PAID, paid_date: { gte: monthStart } },
        _sum: { total_pence: true },
        _count: true,
      }),

      // 6. Revenue collected last month
      this.prisma.client.invoice.aggregate({
        where: { company_id: companyId, status: InvoiceStatus.PAID, paid_date: { gte: prevMonthStart, lt: monthStart } },
        _sum: { total_pence: true },
      }),

      // 7. Revenue collected this week
      this.prisma.client.invoice.aggregate({
        where: { company_id: companyId, status: InvoiceStatus.PAID, paid_date: { gte: weekStart, lt: weekEnd } },
        _sum: { total_pence: true },
      }),

      // 8. Outstanding (all sent + part-paid, regardless of due date)
      this.prisma.client.invoice.aggregate({
        where: { company_id: companyId, status: { in: [InvoiceStatus.SENT, InvoiceStatus.PART_PAID] } },
        _sum: { amount_due_pence: true },
        _count: true,
      }),

      // 9. Pending quotes (sent, awaiting response)
      this.prisma.client.quote.findMany({
        where: { company_id: companyId, status: 'SENT' },
        include: { customer: { select: { name: true } } },
        orderBy: { updated_at: 'asc' },
        take: 5,
      }),

      // 10. Accepted quotes — 90-day win rate
      this.prisma.client.quote.count({
        where: { company_id: companyId, status: 'ACCEPTED', created_at: { gte: new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000) } },
      }),

      // 11. Rejected quotes — 90-day win rate
      this.prisma.client.quote.count({
        where: { company_id: companyId, status: 'REJECTED', created_at: { gte: new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000) } },
      }),

      // 12. Team hours this week
      this.prisma.client.timesheet.aggregate({
        where: { company_id: companyId, date: { gte: weekStart, lt: weekEnd } },
        _sum: { duration_minutes: true },
      }),

      // 13. Overdue todos (max 6 for dashboard sticky notes)
      this.prisma.client.todo.findMany({
        where: { company_id: companyId, status: 'OPEN', due_date: { lt: todayStart } },
        orderBy: { due_date: 'asc' },
        select: { id: true, title: true, due_date: true, priority: true },
        take: 6,
      }),

      // 14. Todos due today (max 6 for dashboard sticky notes)
      this.prisma.client.todo.findMany({
        where: { company_id: companyId, status: 'OPEN', due_date: { gte: todayStart, lt: todayEnd } },
        select: { id: true, title: true, priority: true },
        take: 6,
      }),

      // 15. CIS compliance data
      this.getCisData(companyId, now),

      // 16. Recent paid invoices
      this.getRecentActivity(companyId),

      // 17. Company name for greeting
      this.prisma.client.company.findUnique({
        where: { id: companyId },
        select: { name: true },
      }),

      // 18. Autopilot events this week (for feed card)
      this.prisma.client.autopilotEvent.findMany({
        where: { company_id: companyId, created_at: { gte: weekStart } },
        orderBy: { created_at: 'desc' },
        take: 20,
      }),

      // 19. Chase policy — enabled flag for empty-state CTA
      this.prisma.client.chasePolicy.findUnique({
        where: { company_id: companyId },
        select: { enabled: true },
      }),
    ]);

    const thisMonthPence  = paidThisMonth._sum.total_pence ?? 0;
    const lastMonthPence  = paidLastMonth._sum.total_pence ?? 0;
    const monthChangePct  = this.calcRevenueChange(thisMonthPence, lastMonthPence);
    const quoteWinRate    = acceptedQuotes + rejectedQuotes > 0
      ? Math.round((acceptedQuotes / (acceptedQuotes + rejectedQuotes)) * 100)
      : null;

    const actions = this.buildActions(overdueInvoices, unbilledJobs, cisData, pendingQuotes);

    const overdueTotal    = overdueInvoices.reduce((s, i) => s + i.amount_due_pence, 0);
    const unbilledTotal   = unbilledJobs.reduce((s, j) => s + (j.quotes[0]?.total_pence ?? 0), 0);

    return {
      greeting: this.getGreeting(companyData?.name),

      money: {
        owed:            (outstandingInvoices._sum.amount_due_pence ?? 0) / 100,
        owed_count:      outstandingInvoices._count,
        overdue:         overdueTotal / 100,
        overdue_count:   overdueInvoices.length,
        this_month:      thisMonthPence / 100,
        last_month:      lastMonthPence / 100,
        month_change_pct: monthChangePct,
      },

      actions,

      todaysJobs: todaysJobs.map(j => {
        const parts: string[] = [];
        if (j.customer?.address_line1) parts.push(j.customer.address_line1);
        if (j.customer?.postcode) parts.push(j.customer.postcode);
        return {
          id:              j.id,
          title:           j.title,
          customer:        j.customer?.name ?? null,
          customerAddress: parts.length > 0 ? parts.join(', ') : null,
          engineer:        j.engineer?.name ?? null,
          engineerColour:  j.engineer?.calendar_colour ?? null,
          time:            j.scheduled_at
            ? j.scheduled_at.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
            : null,
          status:          j.status,
          isUrgent:        j.title.toLowerCase().includes('emergency') || j.title.toLowerCase().includes('urgent'),
        };
      }),

      todos: {
        overdue: overdueTodos.map(t => ({
          id:         t.id,
          title:      t.title,
          priority:   t.priority,
          daysOverdue: t.due_date
            ? Math.floor((now.getTime() - t.due_date.getTime()) / (1000 * 60 * 60 * 24))
            : 0,
        })),
        dueToday: dueTodayTodos.map(t => ({ id: t.id, title: t.title, priority: t.priority })),
      },

      week: {
        jobs_count:  thisWeekJobCount,
        win_rate:    quoteWinRate,
        team_hours:  Math.round((timesheetsThisWeek._sum.duration_minutes ?? 0) / 60),
        collected:   (paidThisWeek._sum.total_pence ?? 0) / 100,
      },

      overdue: overdueInvoices.map(i => ({
        id:       i.id,
        number:   i.invoice_number,
        customer: i.customer?.name ?? null,
        phone:    i.customer?.phone ?? null,
        amount:   i.amount_due_pence / 100,
        days:     i.due_date
          ? Math.floor((now.getTime() - i.due_date.getTime()) / (1000 * 60 * 60 * 24))
          : 0,
      })),

      unbilled: unbilledJobs.map(j => ({
        id:             j.id,
        title:          j.title,
        customer:       j.customer?.name ?? null,
        estimatedValue: (j.quotes[0]?.total_pence ?? 0) / 100,
      })),

      pendingQuotes: pendingQuotes.map(q => ({
        id:       q.id,
        number:   q.quote_number,
        customer: q.customer?.name ?? null,
        amount:   q.total_pence / 100,
        daysSent: Math.floor((now.getTime() - q.updated_at.getTime()) / (1000 * 60 * 60 * 24)),
      })),

      // Summary counts for chat context
      overdueCount:  overdueInvoices.length,
      overdueAmount: overdueTotal / 100,
      unbilledCount: unbilledJobs.length,
      unbilledValue: unbilledTotal / 100,

      cis:            cisData,
      recentActivity,

      autopilot: {
        weekCount:    autopilotEvents.length,
        items:        autopilotEvents.slice(0, 8).map(e => ({
          id:         e.id,
          type:       e.type,
          title:      e.title,
          created_at: e.created_at.toISOString(),
        })),
        chaseEnabled: chasePolicy?.enabled ?? false,
      },
    };
  }

  // ── PRIORITISED ACTIONS ───────────────────────────────────────────────────

  private buildActions(
    overdueInvoices: Array<{ customer: { name: string } | null; amount_due_pence: number }>,
    unbilledJobs: Array<{ quotes: Array<{ total_pence: number }> }>,
    cisData: { submitted: boolean; daysUntilDeadline: number } | null,
    pendingQuotes: Array<{ customer: { name: string } | null; updated_at: Date; total_pence: number }>,
  ) {
    type Action = {
      priority: number;
      icon: string;
      category: string;
      title: string;
      detail: string;
      action_label: string;
      action_type: string;
      action_data: Record<string, unknown>;
      severity: 'urgent' | 'warning' | 'info';
      amount: number | null;
    };
    const actions: Action[] = [];

    if (overdueInvoices.length > 0) {
      const total  = overdueInvoices.reduce((s, i) => s + i.amount_due_pence, 0);
      const names  = overdueInvoices.slice(0, 3).map(i => i.customer?.name ?? 'Unknown').join(', ');
      actions.push({
        priority: 100,
        icon: '💷',
        category: 'Revenue at risk',
        title: `Chase ${overdueInvoices.length} overdue invoice${overdueInvoices.length > 1 ? 's' : ''} — £${Math.round(total / 100).toLocaleString()}`,
        detail: names,
        action_label: 'Chase all',
        action_type: 'pip_command',
        action_data: { command: 'Send payment reminders for all overdue invoices' },
        severity: 'urgent',
        amount: total / 100,
      });
    }

    if (unbilledJobs.length > 0) {
      const total = unbilledJobs.reduce((s, j) => s + (j.quotes[0]?.total_pence ?? 0), 0);
      actions.push({
        priority: 80,
        icon: '📋',
        category: 'Unbilled work',
        title: `Invoice ${unbilledJobs.length} completed job${unbilledJobs.length > 1 ? 's' : ''}${total > 0 ? ` — ~£${Math.round(total / 100).toLocaleString()}` : ''}`,
        detail: 'Completed but not yet invoiced',
        action_label: 'Review',
        action_type: 'navigate',
        action_data: { url: '/dashboard/jobs?status=COMPLETED' },
        severity: 'warning',
        amount: total > 0 ? total / 100 : null,
      });
    }

    if (cisData && !cisData.submitted && cisData.daysUntilDeadline <= 14) {
      actions.push({
        priority: cisData.daysUntilDeadline <= 3 ? 95 : 70,
        icon: '⏰',
        category: 'Compliance',
        title: `CIS return due ${cisData.daysUntilDeadline === 0 ? 'TODAY' : `in ${cisData.daysUntilDeadline} day${cisData.daysUntilDeadline > 1 ? 's' : ''}`}`,
        detail: 'Monthly CIS300 not yet submitted',
        action_label: 'Open CIS',
        action_type: 'navigate',
        action_data: { url: '/dashboard/cis' },
        severity: cisData.daysUntilDeadline <= 3 ? 'urgent' : 'warning',
        amount: null,
      });
    }

    if (pendingQuotes.length > 0) {
      const oldest = pendingQuotes[0];
      const days   = Math.floor((Date.now() - oldest.updated_at.getTime()) / (1000 * 60 * 60 * 24));
      const total  = pendingQuotes.reduce((s, q) => s + q.total_pence, 0);
      if (days >= 7) {
        actions.push({
          priority: 50,
          icon: '📝',
          category: 'Pipeline',
          title: `${pendingQuotes.length} quote${pendingQuotes.length > 1 ? 's' : ''} unanswered 7+ days — £${Math.round(total / 100).toLocaleString()}`,
          detail: oldest.customer?.name ? `Oldest: ${oldest.customer.name} (${days} days)` : `${days} days waiting`,
          action_label: 'Follow up',
          action_type: 'pip_command',
          action_data: { command: 'Help me follow up on my outstanding quotes' },
          severity: 'info',
          amount: total / 100,
        });
      }
    }

    return actions.sort((a, b) => b.priority - a.priority);
  }

  // ── HELPERS ───────────────────────────────────────────────────────────────

  private getGreeting(companyName?: string | null): string {
    const hour = new Date().getHours();
    const time = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
    return companyName ? `${time}, ${companyName}` : time;
  }

  private calcRevenueChange(current: number, previous: number): number {
    if (previous === 0) return current > 0 ? 100 : 0;
    return ((current - previous) / previous) * 100;
  }

  private async getCisData(companyId: string, now: Date) {
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const subPayments  = await this.prisma.client.subcontractorPayment.count({
      where: { company_id: companyId, tax_month: currentMonth },
    });
    if (subPayments === 0) return null;

    const returnStatus = await this.prisma.client.cisMonthlyReturn.findUnique({
      where: { company_id_tax_month: { company_id: companyId, tax_month: currentMonth } },
    });

    const monthNum      = now.getMonth() + 1;
    const yearNum       = now.getFullYear();
    const deadlineMonth = monthNum === 12 ? 1 : monthNum + 1;
    const deadlineYear  = monthNum === 12 ? yearNum + 1 : yearNum;
    const deadline      = new Date(deadlineYear, deadlineMonth - 1, 19);
    const daysUntilDeadline = Math.ceil(
      (deadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
    );

    return {
      submitted:          !!returnStatus,
      daysUntilDeadline,
      deadline:           deadline.toLocaleDateString('en-GB'),
      paymentCount:       subPayments,
    };
  }

  private async getRecentActivity(companyId: string) {
    const recent = await this.prisma.client.invoice.findMany({
      where: { company_id: companyId, status: InvoiceStatus.PAID },
      orderBy: { paid_date: 'desc' },
      take: 4,
      include: { customer: { select: { name: true } } },
    });
    return recent.map(i => ({
      type:        'payment_received',
      description: `${i.customer?.name ?? 'Customer'} paid ${i.invoice_number}`,
      amount:      i.total_pence / 100,
      date:        (i.paid_date ?? i.updated_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
    }));
  }
}
