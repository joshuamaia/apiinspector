import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import type { ChartConfiguration } from 'chart.js';
import { SettingsService } from '../../core/services/settings.service';
import { HistoryStore, type HistoryEntry } from '../../core/state/history.store';
import { WorkspaceStore } from '../../core/state/workspace.store';
import { formatBytes, formatDateTime, formatMs, statusTone } from '../../core/utils/format';
import { ChartComponent } from '../../shared/components/chart/chart.component';
import { Router } from '@angular/router';
import { IconComponent } from '../../shared/components/icon/icon.component';

type Period = '15m' | '1h' | '24h' | '7d' | '30d' | 'all' | 'custom';

const PERIODS: { id: Period; label: string; ms: number | null }[] = [
  { id: '15m', label: '15 min', ms: 15 * 60_000 },
  { id: '1h', label: '1 hour', ms: 3_600_000 },
  { id: '24h', label: '24 hours', ms: 86_400_000 },
  { id: '7d', label: '7 days', ms: 7 * 86_400_000 },
  { id: '30d', label: '30 days', ms: 30 * 86_400_000 },
  { id: 'all', label: 'All', ms: null },
  { id: 'custom', label: 'Custom', ms: null },
];


function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function toLocalInput(ts: number): string {
  const d = new Date(ts - new Date().getTimezoneOffset() * 60_000);
  return d.toISOString().slice(0, 16);
}

@Component({
  selector: 'app-metrics-page',
  imports: [ChartComponent, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './metrics-page.component.html',
  styleUrl: './metrics-page.component.scss',
})
export class MetricsPageComponent {
  private readonly history = inject(HistoryStore);
  private readonly settings = inject(SettingsService);
  private readonly workspace = inject(WorkspaceStore);
  private readonly router = inject(Router);

  protected readonly periods = PERIODS;
  protected readonly period = signal<Period>('24h');
  protected readonly requestKey = signal<string>('');
  protected readonly from = signal(toLocalInput(Date.now() - 86_400_000));
  protected readonly to = signal(toLocalInput(Date.now()));
  protected readonly formatMs = formatMs;
  protected readonly formatBytes = formatBytes;
  protected readonly formatDateTime = formatDateTime;
  protected readonly statusTone = statusTone;

  /** Distinct requests seen in history (latest name wins). */
  protected readonly requests = computed(() => {
    const map = new Map<string, { key: string; label: string; count: number }>();
    for (const e of this.history.entries()) {
      const existing = map.get(e.requestKey);
      if (existing) existing.count++;
      else map.set(e.requestKey, { key: e.requestKey, label: `${e.request.method} ${e.name}`, count: 1 });
    }
    return [...map.values()].sort((a, b) => b.count - a.count);
  });

  protected readonly filtered = computed<HistoryEntry[]>(() => {
    const period = PERIODS.find((p) => p.id === this.period())!;
    const now = Date.now();
    let start = period.ms ? now - period.ms : 0;
    let end = Infinity;
    if (period.id === 'custom') {
      start = new Date(this.from()).getTime() || 0;
      end = new Date(this.to()).getTime() || Infinity;
    }
    const key = this.requestKey();
    return this.history.entries().filter((e) => e.createdAt >= start && e.createdAt <= end && (!key || e.requestKey === key));
  });

  protected readonly kpis = computed(() => {
    const list = this.filtered();
    const responses = list.filter((e) => e.outcome === 'response');
    const success = responses.filter((e) => (e.status ?? 0) < 400).length;
    const httpErrors = responses.length - success;
    const transport = list.length - responses.length;
    const durations = responses.map((e) => e.durationMs).sort((a, b) => a - b);
    const avg = durations.length ? durations.reduce((s, d) => s + d, 0) / durations.length : 0;
    return {
      total: list.length,
      success,
      httpErrors,
      transport,
      failures: httpErrors + transport,
      rate: list.length ? (success / list.length) * 100 : 0,
      avg,
      min: durations[0] ?? 0,
      max: durations.at(-1) ?? 0,
      p95: percentile(durations, 95),
    };
  });

  private colors() {
    this.settings.settings(); // re-read tokens when the theme changes
    const css = getComputedStyle(document.documentElement);
    const v = (name: string) => css.getPropertyValue(name).trim();
    return {
      series: v('--viz-series-1'),
      text: v('--text-dim'),
      grid: v('--border'),
      surface: v('--panel'),
      success: v('--success'),
      info: v('--info'),
      warning: v('--warning'),
      danger: v('--danger'),
    };
  }

  private baseOptions(c: ReturnType<MetricsPageComponent['colors']>, horizontal = false) {
    const valueAxis = { grid: { color: c.grid }, border: { display: false }, ticks: { color: c.text, font: { size: 11 } }, beginAtZero: true };
    const categoryAxis = { grid: { display: false }, border: { color: c.grid }, ticks: { color: c.text, font: { size: 11 }, autoSkip: true, maxRotation: 0 } };
    return {
      animation: { duration: 250 },
      interaction: { mode: 'nearest' as const, intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: { backgroundColor: c.surface, titleColor: c.text, bodyColor: c.text, borderColor: c.grid, borderWidth: 1, padding: 10, cornerRadius: 8 },
      },
      indexAxis: horizontal ? ('y' as const) : ('x' as const),
      scales: horizontal ? { x: valueAxis, y: categoryAxis } : { x: categoryAxis, y: valueAxis },
    };
  }

  /** Response time per execution, oldest → newest (single series: no legend; HTTP/transport errors marked). */
  protected readonly timeChart = computed<ChartConfiguration>(() => {
    const c = this.colors();
    const points = [...this.filtered()].reverse().slice(-300);
    const pointColor = points.map((e) => (e.outcome === 'error' ? c.danger : (e.status ?? 0) >= 400 ? c.warning : c.series));
    const base = this.baseOptions(c);
    return {
      type: 'line',
      data: {
        labels: points.map((e) => new Date(e.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })),
        datasets: [
          {
            label: 'Response time (ms)',
            data: points.map((e) => Math.round(e.durationMs * 100) / 100),
            borderColor: c.series,
            backgroundColor: pointColor,
            pointBackgroundColor: pointColor,
            pointBorderColor: c.surface,
            pointBorderWidth: 2,
            pointRadius: 4,
            pointHoverRadius: 6,
            borderWidth: 2,
            tension: 0.2,
            cubicInterpolationMode: 'monotone',
          },
        ],
      },
      options: {
        ...base,
        plugins: {
          ...base.plugins,
          tooltip: {
            ...base.plugins.tooltip,
            callbacks: {
              title: (items) => {
                const e = points[items[0].dataIndex];
                return `${e.request.method} ${e.name}`;
              },
              label: (item) => {
                const e = points[item.dataIndex];
                return ` ${formatMs(e.durationMs)} · ${e.outcome === 'error' ? e.error?.kind : `HTTP ${e.status}`}`;
              },
            },
          },
        },
      },
    } as ChartConfiguration;
  });

  /** Executions by status class — status colors carry state, labels carry identity. */
  protected readonly statusChart = computed<ChartConfiguration>(() => {
    const c = this.colors();
    const buckets = [
      { label: '2xx success', color: c.success, count: 0 },
      { label: '3xx redirect', color: c.info, count: 0 },
      { label: '4xx client error', color: c.warning, count: 0 },
      { label: '5xx server error', color: c.danger, count: 0 },
      { label: 'Transport error', color: c.text, count: 0 },
    ];
    for (const e of this.filtered()) {
      if (e.outcome === 'error') buckets[4].count++;
      else {
        const cls = Math.floor((e.status ?? 0) / 100);
        if (cls === 2 || cls === 1) buckets[0].count++;
        else if (cls === 3) buckets[1].count++;
        else if (cls === 4) buckets[2].count++;
        else buckets[3].count++;
      }
    }
    return {
      type: 'bar',
      data: {
        labels: buckets.map((b) => b.label),
        datasets: [{ label: 'Executions', data: buckets.map((b) => b.count), backgroundColor: buckets.map((b) => b.color), borderRadius: 4, borderSkipped: 'start', barThickness: 18 }],
      },
      options: this.baseOptions(c, true),
    } as ChartConfiguration;
  });

  /** Average response time per request (top 8 slowest). */
  protected readonly perRequestChart = computed<ChartConfiguration>(() => {
    const c = this.colors();
    const groups = new Map<string, { label: string; total: number; n: number }>();
    for (const e of this.filtered()) {
      if (e.outcome !== 'response') continue;
      const g = groups.get(e.requestKey) ?? { label: `${e.request.method} ${e.name}`, total: 0, n: 0 };
      g.total += e.durationMs;
      g.n++;
      groups.set(e.requestKey, g);
    }
    const rows = [...groups.values()].map((g) => ({ label: g.label.length > 32 ? `${g.label.slice(0, 32)}…` : g.label, avg: g.total / g.n })).sort((a, b) => b.avg - a.avg).slice(0, 8);
    return {
      type: 'bar',
      data: {
        labels: rows.map((r) => r.label),
        datasets: [{ label: 'Average (ms)', data: rows.map((r) => Math.round(r.avg * 10) / 10), backgroundColor: c.series, borderRadius: 4, borderSkipped: 'start', barThickness: 16 }],
      },
      options: this.baseOptions(c, true),
    } as ChartConfiguration;
  });

  protected readonly errorKinds = computed(() => {
    const map = new Map<string, number>();
    for (const e of this.filtered()) if (e.outcome === 'error' && e.error) map.set(e.error.kind, (map.get(e.error.kind) ?? 0) + 1);
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  });

  protected readonly recent = computed(() => this.filtered().slice(0, 50));

  protected async open(entry: HistoryEntry): Promise<void> {
    await this.workspace.openExecution(entry.id);
    void this.router.navigateByUrl('/');
  }
}
