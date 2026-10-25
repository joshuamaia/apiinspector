import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, output, signal } from '@angular/core';
import { Router } from '@angular/router';
import type { ExecutionRecord } from '../../../core/models/execution.model';
import type { ResponseCookie } from '../../../core/models/proxy.model';
import { formatBytes, formatDateTime, formatMs, statusText, statusTone } from '../../../core/utils/format';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import { explainError } from './error-info';
import { ResponseBodyComponent } from './response-body.component';

type ResponseTab = 'body' | 'headers' | 'cookies' | 'request' | 'timeline';

const SENSITIVE_COOKIE = /(sess|token|auth|sid|jwt|secret|key|csrf|xsrf)/i;

@Component({
  selector: 'app-response-viewer',
  imports: [IconComponent, ResponseBodyComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './response-viewer.component.html',
  styleUrl: './response-viewer.component.scss',
})
export class ResponseViewerComponent {
  private readonly router = inject(Router);
  readonly record = input<ExecutionRecord | null>(null);
  readonly running = input(false);
  readonly cancel = output<void>();
  readonly retry = output<void>();

  protected readonly tab = signal<ResponseTab>('body');
  protected readonly headerFilter = signal('');
  protected readonly revealed = signal<Set<string>>(new Set());
  protected readonly elapsed = signal(0);
  protected readonly formatMs = formatMs;
  protected readonly formatBytes = formatBytes;
  protected readonly formatDateTime = formatDateTime;

  protected readonly response = computed(() => this.record()?.response ?? null);
  protected readonly error = computed(() => this.record()?.error ?? null);
  protected readonly explanation = computed(() => (this.error() ? explainError(this.error()!.kind) : null));
  protected readonly tone = computed(() => statusTone(this.response()?.status));
  protected readonly statusLabel = computed(() => {
    const r = this.response();
    return r ? `${r.status} ${statusText(r.status, r.statusText)}` : '';
  });
  protected readonly filteredHeaders = computed(() => {
    const q = this.headerFilter().trim().toLowerCase();
    const headers = this.response()?.headers ?? [];
    return q ? headers.filter(([k, v]) => k.toLowerCase().includes(q) || v.toLowerCase().includes(q)) : headers;
  });
  protected readonly timingBars = computed(() => {
    const t = this.record()?.timings;
    if (!t) return [];
    // Phases are cumulative offsets within the first hop; convert into segments.
    const phases: { label: string; start: number; end: number; color: string }[] = [];
    let cursor = 0;
    const push = (label: string, end: number | null, color: string) => {
      if (end === null || end < cursor) return;
      phases.push({ label, start: cursor, end, color });
      cursor = end;
    };
    push('DNS lookup', t.dns, 'var(--info)');
    push('TCP connect', t.connect, 'var(--accent-2)');
    push('TLS handshake', t.tls, 'var(--warning)');
    push('Waiting (TTFB)', t.ttfb, 'var(--accent)');
    push('Download', t.total, 'var(--success)');
    const total = Math.max(t.total, 0.01);
    return phases.map((p) => ({ ...p, duration: p.end - p.start, left: (p.start / total) * 100, width: Math.max(0.6, ((p.end - p.start) / total) * 100) }));
  });

  constructor() {
    let timer: ReturnType<typeof setInterval> | null = null;
    effect(() => {
      if (this.running()) {
        const start = performance.now();
        this.elapsed.set(0);
        timer = setInterval(() => this.elapsed.set(performance.now() - start), 100);
      } else if (timer) {
        clearInterval(timer);
        timer = null;
      }
    });
    inject(DestroyRef).onDestroy(() => timer && clearInterval(timer));
    effect(() => {
      // New execution: re-mask revealed cookie values.
      this.record();
      this.revealed.set(new Set());
    });
  }

  protected isSensitiveCookie(cookie: ResponseCookie): boolean {
    return SENSITIVE_COOKIE.test(cookie.name) || cookie.httpOnly;
  }

  protected cookieValue(cookie: ResponseCookie): string {
    if (!this.isSensitiveCookie(cookie) || this.revealed().has(cookie.name)) return cookie.value;
    return cookie.value.length <= 4 ? '••••' : `${cookie.value.slice(0, 2)}${'•'.repeat(Math.min(12, cookie.value.length - 4))}${cookie.value.slice(-2)}`;
  }

  protected toggleCookie(name: string): void {
    const next = new Set(this.revealed());
    if (next.has(name)) next.delete(name);
    else next.add(name);
    this.revealed.set(next);
  }

  protected compare(): void {
    const id = this.record()?.id;
    if (id) void this.router.navigate(['/diff'], { queryParams: { left: id } });
  }

  protected saveBaseline(): void {
    const id = this.record()?.id;
    if (id) void this.router.navigate(['/drift'], { queryParams: { fromExecution: id } });
  }
}
