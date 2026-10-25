import { Clipboard } from '@angular/cdk/clipboard';
import { Dialog } from '@angular/cdk/dialog';
import { CdkMenu, CdkMenuItem, CdkMenuTrigger } from '@angular/cdk/menu';
import { CdkFixedSizeVirtualScroll, CdkVirtualForOf, CdkVirtualScrollViewport } from '@angular/cdk/scrolling';
import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { DIFF_DEMO } from '../../core/demo/demo-data';
import { ToastService } from '../../core/services/toast.service';
import { HistoryStore } from '../../core/state/history.store';
import { downloadFile } from '../../core/utils/download';
import { formatBytes, formatMs, statusTone, timeAgo } from '../../core/utils/format';
import { tryParseJson } from '../../core/utils/json';
import { diffHeaders, diffJson, diffText, type ChangeKind, type DiffChange, type DiffOptions, type DiffRow, type TextDiffRow } from '../../core/utils/json-diff';
import { IconComponent } from '../../shared/components/icon/icon.component';
import { PasteResponseDialogComponent, type PastedResponse } from './paste-response-dialog.component';

export interface DiffSide {
  label: string;
  origin: 'history' | 'paste' | 'demo';
  executionId?: string;
  status?: number;
  durationMs?: number;
  size?: number;
  headers: [string, string][];
  body: string;
}

const DEFAULT_IGNORED_HEADERS = ['date', 'age', 'x-request-id', 'cf-ray', 'set-cookie', 'report-to', 'nel', 'server-timing', 'x-amz-request-id'];
const ROW_HEIGHT = 20;

@Component({
  selector: 'app-diff-page',
  imports: [IconComponent, CdkVirtualScrollViewport, CdkFixedSizeVirtualScroll, CdkVirtualForOf, CdkMenu, CdkMenuItem, CdkMenuTrigger],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './diff-page.component.html',
  styleUrl: './diff-page.component.scss',
})
export class DiffPageComponent {
  private readonly route = inject(ActivatedRoute);
  protected readonly history = inject(HistoryStore);
  private readonly dialog = inject(Dialog);
  private readonly clipboard = inject(Clipboard);
  private readonly toast = inject(ToastService);
  private readonly viewport = viewChild<CdkVirtualScrollViewport>('viewport');
  private readonly params = toSignal(this.route.queryParamMap);

  protected readonly rowHeight = ROW_HEIGHT;
  protected readonly formatMs = formatMs;
  protected readonly formatBytes = formatBytes;
  protected readonly statusTone = statusTone;
  protected readonly timeAgo = timeAgo;

  protected readonly left = signal<DiffSide | null>(null);
  protected readonly right = signal<DiffSide | null>(null);
  protected readonly options = signal<DiffOptions>({
    arrayStrategy: 'index',
    arrayKey: 'id',
    ignorePaths: [],
    ignoreTimestamps: false,
    ignoreUuids: false,
    ignoreIds: false,
  });
  protected readonly ignoredHeaders = signal<string[]>(DEFAULT_IGNORED_HEADERS);
  protected readonly changeFilter = signal('');
  protected readonly kindFilter = signal<ChangeKind | null>(null);
  protected readonly current = signal(-1);
  protected readonly showHeaders = signal(false);

  /** Executions that have a response (candidates for comparison). */
  protected readonly candidates = computed(() => this.history.entries().filter((e) => e.outcome === 'response').slice(0, 200));

  protected readonly parsed = computed(() => {
    const l = this.left();
    const r = this.right();
    if (!l || !r) return null;
    const lj = tryParseJson(l.body);
    const rj = tryParseJson(r.body);
    return lj.ok && rj.ok ? { mode: 'json' as const, left: lj.value, right: rj.value } : { mode: 'text' as const };
  });

  protected readonly result = computed(() => {
    const p = this.parsed();
    if (!p || p.mode !== 'json') return null;
    return diffJson(p.left, p.right, this.options());
  });

  protected readonly textRows = computed<TextDiffRow[]>(() => {
    const p = this.parsed();
    if (!p || p.mode !== 'text') return [];
    return diffText(this.left()!.body, this.right()!.body);
  });

  protected readonly rows = computed<(DiffRow | TextDiffRow)[]>(() => this.result()?.rows ?? this.textRows());

  protected readonly changeRowIndex = computed(() => {
    const map = new Map<number, number>();
    this.result()?.rows.forEach((row, i) => row.changeIndex !== undefined && map.set(row.changeIndex, i));
    return map;
  });

  protected readonly filteredChanges = computed<DiffChange[]>(() => {
    const changes = this.result()?.changes ?? [];
    const q = this.changeFilter().trim().toLowerCase();
    const kind = this.kindFilter();
    return changes.filter(
      (c) => (!kind || c.kind === kind) && (!q || c.path.toLowerCase().includes(q) || this.preview(c.left).toLowerCase().includes(q) || this.preview(c.right).toLowerCase().includes(q)),
    );
  });

  protected readonly textStats = computed(() => {
    const rows = this.textRows();
    return { added: rows.filter((r) => r.kind === 'added').length, removed: rows.filter((r) => r.kind === 'removed').length };
  });

  protected readonly headerDiff = computed(() => {
    const l = this.left();
    const r = this.right();
    if (!l || !r) return [];
    return diffHeaders(l.headers, r.headers, this.ignoredHeaders());
  });
  protected readonly headerChanges = computed(() => this.headerDiff().filter((h) => h.kind !== 'equal').length);

  protected readonly timing = computed(() => {
    const l = this.left()?.durationMs;
    const r = this.right()?.durationMs;
    if (l === undefined || r === undefined) return null;
    const delta = r - l;
    return { delta, pct: l > 0 ? (delta / l) * 100 : 0 };
  });

  constructor() {
    // Load sides from ?left=&right= (history ids).
    effect(() => {
      const params = this.params();
      const leftId = params?.get('left');
      const rightId = params?.get('right');
      untracked(() => void this.loadFromParams(leftId ?? null, rightId ?? null));
    });
    effect(() => {
      this.result();
      untracked(() => this.current.set(-1));
    });
  }

  private async loadFromParams(leftId: string | null, rightId: string | null): Promise<void> {
    if (leftId) await this.pickExecution('left', leftId);
    if (rightId) await this.pickExecution('right', rightId);
    else if (leftId) {
      // Smart default: previous execution of the same request.
      const leftEntry = this.history.entries().find((e) => e.id === leftId);
      const sibling = this.candidates().find((e) => e.id !== leftId && leftEntry && e.requestKey === leftEntry.requestKey);
      if (sibling) await this.pickExecution('right', sibling.id);
    }
    if (!leftId && !rightId && !this.left() && !this.right()) this.loadDemo();
  }

  protected async pickExecution(side: 'left' | 'right', id: string): Promise<void> {
    if (!id) return;
    const record = await this.history.get(id);
    if (!record?.response) {
      this.toast.error('That execution has no stored response');
      return;
    }
    const value: DiffSide = {
      label: `${record.request.method} ${record.name} · ${new Date(record.createdAt).toLocaleTimeString()}`,
      origin: 'history',
      executionId: record.id,
      status: record.status,
      durationMs: record.durationMs,
      size: record.response.size,
      headers: record.response.headers,
      body: record.response.bodyEncoding === 'utf8' ? record.response.body : `[binary ${formatBytes(record.response.size)}]`,
    };
    (side === 'left' ? this.left : this.right).set(value);
  }

  protected loadDemo(): void {
    const toSide = (d: { label: string; status: number; durationMs: number; headers: [string, string][]; body: unknown }): DiffSide => ({
      label: d.label,
      origin: 'demo',
      status: d.status,
      durationMs: d.durationMs,
      headers: d.headers,
      body: JSON.stringify(d.body, null, 2),
      size: JSON.stringify(d.body, null, 2).length,
    });
    this.left.set(toSide(DIFF_DEMO.left));
    this.right.set(toSide(DIFF_DEMO.right));
  }

  protected async paste(side: 'left' | 'right'): Promise<void> {
    const currentSide = side === 'left' ? this.left() : this.right();
    const ref = this.dialog.open<PastedResponse>(PasteResponseDialogComponent, {
      data: { side, label: currentSide?.origin === 'paste' ? currentSide.label : '', body: currentSide?.body ?? '' },
      backdropClass: 'cdk-overlay-dark-backdrop',
    });
    const pasted = await firstValueFrom(ref.closed);
    if (!pasted) return;
    (side === 'left' ? this.left : this.right).set({ label: pasted.label, origin: 'paste', status: pasted.status, headers: [], body: pasted.body, size: pasted.body.length });
  }

  protected swap(): void {
    const l = this.left();
    this.left.set(this.right());
    this.right.set(l);
  }

  // ---- options ----
  protected setOption<K extends keyof DiffOptions>(key: K, value: DiffOptions[K]): void {
    this.options.update((o) => ({ ...o, [key]: value }));
  }

  protected addIgnorePath(input: HTMLInputElement): void {
    const value = input.value.trim();
    if (value && !this.options().ignorePaths.includes(value)) this.setOption('ignorePaths', [...this.options().ignorePaths, value]);
    input.value = '';
  }

  protected removeIgnorePath(path: string): void {
    this.setOption(
      'ignorePaths',
      this.options().ignorePaths.filter((p) => p !== path),
    );
  }

  protected ignoreChangePath(change: DiffChange): void {
    if (!this.options().ignorePaths.includes(change.path)) this.setOption('ignorePaths', [...this.options().ignorePaths, change.path]);
  }

  protected addIgnoredHeader(input: HTMLInputElement): void {
    const value = input.value.trim().toLowerCase();
    if (value && !this.ignoredHeaders().includes(value)) this.ignoredHeaders.update((h) => [...h, value]);
    input.value = '';
  }

  protected removeIgnoredHeader(name: string): void {
    this.ignoredHeaders.update((h) => h.filter((x) => x !== name));
  }

  // ---- navigation ----
  protected goTo(change: DiffChange): void {
    const all = this.result()?.changes ?? [];
    this.current.set(all.indexOf(change));
    const row = this.changeRowIndex().get(change.index);
    if (row !== undefined) this.viewport()?.scrollToOffset(Math.max(0, row * ROW_HEIGHT - 120), 'smooth');
  }

  protected step(delta: number): void {
    const list = this.filteredChanges();
    if (!list.length) return;
    const all = this.result()!.changes;
    const currentChange = all[this.current()];
    const pos = currentChange ? list.indexOf(currentChange) : -1;
    const next = list[(pos + delta + list.length) % list.length];
    this.goTo(next);
  }

  protected isCurrent(row: DiffRow | TextDiffRow): boolean {
    const idx = this.current();
    return idx >= 0 && 'changeIndex' in row && row.changeIndex === this.result()?.changes[idx]?.index;
  }

  protected asJsonRow(row: DiffRow | TextDiffRow): DiffRow {
    return row as DiffRow;
  }

  protected preview(value: unknown): string {
    if (value === undefined) return '';
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    return text.length > 90 ? `${text.slice(0, 90)}…` : text;
  }

  protected kindLabel(kind: ChangeKind): string {
    return { added: 'ADD', removed: 'REMOVE', modified: 'MODIFY', 'type-changed': 'TYPE' }[kind];
  }

  // ---- export ----
  private report() {
    const l = this.left()!;
    const r = this.right()!;
    const side = (s: DiffSide) => ({ label: s.label, status: s.status, durationMs: s.durationMs, size: s.size });
    return {
      generatedAt: new Date().toISOString(),
      left: side(l),
      right: side(r),
      options: this.options(),
      summary: this.result()?.stats ?? this.textStats(),
      ignored: this.result()?.ignoredCount ?? 0,
      status: { left: l.status, right: r.status, changed: l.status !== r.status },
      timing: this.timing(),
      headers: this.headerDiff().filter((h) => h.kind !== 'equal'),
      changes: (this.result()?.changes ?? []).map(({ path, kind, left, right }) => ({ path, kind, left, right })),
    };
  }

  private markdown(): string {
    const rep = this.report();
    const lines = [
      `# API diff report`,
      ``,
      `- **Left:** ${rep.left.label} (status ${rep.left.status ?? '—'}, ${formatMs(rep.left.durationMs)})`,
      `- **Right:** ${rep.right.label} (status ${rep.right.status ?? '—'}, ${formatMs(rep.right.durationMs)})`,
      `- **Changes:** ${rep.changes.length} (ignored: ${rep.ignored})`,
      ``,
      `| Kind | Path | From | To |`,
      `| --- | --- | --- | --- |`,
      ...rep.changes.map((c) => `| ${c.kind} | \`${c.path}\` | ${c.left === undefined ? '' : `\`${this.preview(c.left)}\``} | ${c.right === undefined ? '' : `\`${this.preview(c.right)}\``} |`),
    ];
    if (rep.headers.length) {
      lines.push('', '## Headers', '', '| Header | Change | From | To |', '| --- | --- | --- | --- |', ...rep.headers.map((h) => `| ${h.name} | ${h.kind} | ${h.left ?? ''} | ${h.right ?? ''} |`));
    }
    return lines.join('\n');
  }

  protected exportJson(): void {
    downloadFile(`api-diff-${Date.now()}.json`, JSON.stringify(this.report(), null, 2), 'application/json');
  }

  protected exportMarkdown(): void {
    downloadFile(`api-diff-${Date.now()}.md`, this.markdown(), 'text/markdown');
  }

  protected copyMarkdown(): void {
    this.clipboard.copy(this.markdown());
    this.toast.success('Diff summary copied as Markdown');
  }
}
