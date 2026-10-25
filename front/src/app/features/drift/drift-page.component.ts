import { Dialog } from '@angular/cdk/dialog';
import { CdkMenu, CdkMenuItem, CdkMenuTrigger } from '@angular/cdk/menu';
import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { PRODUCT_V2_SAMPLE } from '../../core/demo/demo-data';
import type { ContractBaseline, ContractField, DriftFinding, DriftReport, DriftSeverity, FieldRequirement } from '../../core/models/drift.model';
import { ExecutionService } from '../../core/services/execution.service';
import { ImportExportService } from '../../core/services/import-export.service';
import { ToastService } from '../../core/services/toast.service';
import { CollectionsStore } from '../../core/state/collections.store';
import { DriftStore } from '../../core/state/drift.store';
import { HistoryStore } from '../../core/state/history.store';
import { WorkspaceStore } from '../../core/state/workspace.store';
import { checkContract, inferContract, notJsonReport, suggestRequirements } from '../../core/utils/drift';
import { formatMs, timeAgo } from '../../core/utils/format';
import { tryParseJson, validateJson } from '../../core/utils/json';
import { ConfirmService } from '../../shared/components/dialogs/confirm-dialog.component';
import { IconComponent } from '../../shared/components/icon/icon.component';
import { PasteResponseDialogComponent, type PastedResponse } from '../diff/paste-response-dialog.component';

const VERDICT = {
  compatible: { title: 'Compatible', icon: 'check-circle', text: 'No incompatibilities were detected with the configured rules.' },
  'potentially-incompatible': {
    title: 'Potentially incompatible',
    icon: 'alert',
    text: 'Some changes may affect consumers (type changes or unexpected nulls on optional/unspecified fields, or new fields in strict mode). Review them.',
  },
  incompatible: { title: 'Incompatible', icon: 'x-circle', text: 'Required fields disappeared, changed type or became null. Consumers relying on them will break.' },
  inconclusive: {
    title: 'Inconclusive — insufficient information',
    icon: 'help',
    text: 'Changes affect fields without rules. Mark them as required or optional so the impact can be classified.',
  },
} as const;

const SEVERITY_LABEL: Record<DriftSeverity, string> = { breaking: 'Breaking', risk: 'Risk', unknown: 'Needs rule', info: 'Info' };

@Component({
  selector: 'app-drift-page',
  imports: [IconComponent, CdkMenu, CdkMenuItem, CdkMenuTrigger],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './drift-page.component.html',
  styleUrl: './drift-page.component.scss',
})
export class DriftPageComponent {
  protected readonly store = inject(DriftStore);
  protected readonly history = inject(HistoryStore);
  protected readonly collections = inject(CollectionsStore);
  private readonly workspace = inject(WorkspaceStore);
  private readonly executor = inject(ExecutionService);
  private readonly importExport = inject(ImportExportService);
  private readonly dialog = inject(Dialog);
  private readonly confirm = inject(ConfirmService);
  private readonly toast = inject(ToastService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly params = toSignal(this.route.queryParamMap);

  protected readonly verdicts = VERDICT;
  protected readonly severityLabel = SEVERITY_LABEL;
  protected readonly severities: DriftSeverity[] = ['breaking', 'risk', 'unknown', 'info'];
  protected readonly timeAgo = timeAgo;
  protected readonly formatMs = formatMs;
  protected readonly fieldFilter = signal('');
  protected readonly checking = signal(false);

  protected readonly baseline = this.store.selected;
  protected readonly candidates = computed(() => this.history.entries().filter((e) => e.outcome === 'response').slice(0, 200));
  protected readonly check = computed(() => {
    const b = this.baseline();
    return b ? (this.store.checks()[b.id] ?? null) : null;
  });

  /** Report is derived live from the current rules and the last checked response. */
  protected readonly report = computed<DriftReport | null>(() => {
    const b = this.baseline();
    const c = this.check();
    if (!b || !c) return null;
    if (c.error) return notJsonReport(b.fields, c.error);
    return checkContract(b.fields, c.value, { strictAdditions: b.strictAdditions });
  });

  protected readonly grouped = computed(() => {
    const report = this.report();
    if (!report) return [];
    return this.severities.map((severity) => ({ severity, findings: report.findings.filter((f) => f.severity === severity) })).filter((g) => g.findings.length);
  });

  protected readonly fields = computed(() => {
    const b = this.baseline();
    const q = this.fieldFilter().trim().toLowerCase();
    if (!b) return [];
    const findingsByPath = new Map<string, DriftFinding>();
    for (const f of this.report()?.findings ?? []) if (!findingsByPath.has(f.path)) findingsByPath.set(f.path, f);
    return b.fields
      .filter((f) => !q || f.path.toLowerCase().includes(q))
      .map((f) => ({ field: f, depth: (f.path.match(/\.|\[\]|\['/g) ?? []).length, label: this.leaf(f.path), finding: findingsByPath.get(f.path) ?? null }));
  });

  protected readonly unspecified = computed(() => this.baseline()?.fields.filter((f) => f.requirement === 'unspecified').length ?? 0);

  constructor() {
    effect(() => {
      const id = this.params()?.get('fromExecution');
      if (id) untracked(() => void this.createFromExecution(id, true));
    });
  }

  private leaf(path: string): string {
    if (path === '$') return '$ (root)';
    const m = /(\.[^.[\]]+|\['[^']*'\]|\[\])$/.exec(path);
    return m ? m[1].replace(/^\./, '') : path;
  }

  // ---- baselines ----
  protected async createFromExecution(id: string, fromRoute = false): Promise<void> {
    if (!id) return;
    const record = await this.history.get(id);
    if (fromRoute) void this.router.navigate([], { queryParams: {}, replaceUrl: true });
    if (!record?.response) return this.toast.error('That execution has no stored response');
    const parsed = tryParseJson(record.response.body);
    if (!parsed.ok) return this.toast.error('The response is not JSON; a contract needs a JSON reference');
    await this.store.create(`${record.name} contract`, parsed.value, record.requestId);
    this.toast.success('Baseline created — now mark fields as required or optional');
  }

  protected async createFromActiveTab(): Promise<void> {
    const tab = this.workspace.active();
    if (!tab?.lastExecution) return this.toast.show('Send a request in the workspace first', 'warning');
    await this.createFromExecution(tab.lastExecution.id);
  }

  protected async createFromPaste(): Promise<void> {
    const ref = this.dialog.open<PastedResponse>(PasteResponseDialogComponent, { data: { side: 'reference', label: 'My contract', body: '' }, backdropClass: 'cdk-overlay-dark-backdrop' });
    const pasted = await firstValueFrom(ref.closed);
    if (!pasted) return;
    const v = validateJson(pasted.body);
    if (!v.valid) return this.toast.error(`Invalid JSON: ${v.error?.message}`);
    await this.store.create(pasted.label, v.value);
  }

  protected async loadDemo(): Promise<void> {
    await this.importExport.loadDemo();
    this.store.selectedId.set('demo-baseline-product');
  }

  protected async remove(): Promise<void> {
    const b = this.baseline();
    if (b && (await this.confirm.confirm({ title: 'Delete baseline', message: `Delete "${b.name}"?`, danger: true, confirmLabel: 'Delete' }))) await this.store.remove(b.id);
  }

  private async patch(patch: Partial<ContractBaseline>): Promise<void> {
    const b = this.baseline();
    if (b) await this.store.save({ ...b, ...patch });
  }

  protected rename(name: string): void {
    if (name.trim()) void this.patch({ name: name.trim() });
  }

  protected setLinked(requestId: string): void {
    void this.patch({ requestId: requestId || null });
  }

  protected setStrict(strictAdditions: boolean): void {
    void this.patch({ strictAdditions });
  }

  // ---- rules ----
  protected setRequirement(field: ContractField, requirement: FieldRequirement): void {
    const b = this.baseline();
    if (!b || field.path === '$') return;
    void this.patch({ fields: b.fields.map((f) => (f.path === field.path ? { ...f, requirement } : f)) });
  }

  protected setRequirementByPath(path: string, requirement: FieldRequirement): void {
    const field = this.baseline()?.fields.find((f) => f.path === path);
    if (field) this.setRequirement(field, requirement);
  }

  protected setNullable(field: ContractField, nullable: boolean): void {
    const b = this.baseline();
    if (b) void this.patch({ fields: b.fields.map((f) => (f.path === field.path ? { ...f, nullable } : f)) });
  }

  protected bulk(action: 'suggest' | 'required' | 'optional' | 'reset'): void {
    const b = this.baseline();
    if (!b) return;
    let fields: ContractField[];
    if (action === 'suggest') {
      const sample = tryParseJson(b.sample);
      fields = sample.ok ? suggestRequirements(sample.value, b.fields) : b.fields;
    } else {
      const requirement: FieldRequirement = action === 'reset' ? 'unspecified' : action;
      fields = b.fields.map((f) => (f.path === '$' ? f : { ...f, requirement }));
    }
    void this.patch({ fields });
  }

  protected async reinfer(): Promise<void> {
    const b = this.baseline();
    if (!b) return;
    const sample = tryParseJson(b.sample);
    if (!sample.ok) return;
    const existing = new Map(b.fields.map((f) => [f.path, f]));
    await this.patch({ fields: inferContract(sample.value).map((f) => ({ ...f, requirement: existing.get(f.path)?.requirement ?? f.requirement, nullable: existing.get(f.path)?.nullable ?? f.nullable })) });
  }

  // ---- checks ----
  private setCheckFromBody(label: string, body: string, status?: number): void {
    const b = this.baseline();
    if (!b) return;
    const parsed = validateJson(body);
    this.store.setCheck(b.id, parsed.valid ? { label, checkedAt: Date.now(), value: parsed.value, status } : { label, checkedAt: Date.now(), error: parsed.error?.message ?? 'invalid JSON', status });
  }

  protected async runLinked(): Promise<void> {
    const b = this.baseline();
    if (!b?.requestId) return;
    const opened = await this.collections.openRequest(b.requestId);
    if (!opened) return this.toast.error('The linked request no longer exists');
    this.checking.set(true);
    try {
      const record = await this.executor.execute(opened.def, { name: opened.saved.name, requestId: opened.saved.id });
      if (record.outcome === 'error' || !record.response) {
        this.toast.error(`Request failed: ${record.error?.message}`);
        return;
      }
      this.setCheckFromBody(`${opened.saved.name} · HTTP ${record.status} · ${formatMs(record.durationMs)}`, record.response.body, record.status);
    } finally {
      this.checking.set(false);
    }
  }

  protected async checkExecution(id: string): Promise<void> {
    if (!id) return;
    const record = await this.history.get(id);
    if (!record?.response) return;
    this.setCheckFromBody(`${record.name} · ${new Date(record.createdAt).toLocaleString()}`, record.response.body, record.status);
  }

  protected async checkPaste(): Promise<void> {
    const ref = this.dialog.open<PastedResponse>(PasteResponseDialogComponent, { data: { side: 'to check', label: 'Pasted response', body: '' }, backdropClass: 'cdk-overlay-dark-backdrop' });
    const pasted = await firstValueFrom(ref.closed);
    if (pasted) this.setCheckFromBody(pasted.label, pasted.body, pasted.status);
  }

  protected checkDemo(): void {
    this.setCheckFromBody('Local sample of GET /products/v2/1', JSON.stringify(PRODUCT_V2_SAMPLE));
  }

  protected typeLabel(field: ContractField): string {
    return [...field.types, ...(field.nullable ? ['null'] : [])].join(' | ') || 'null';
  }
}
