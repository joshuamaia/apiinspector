import { KeyValuePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import type { Flow, FlowExtraction, FlowNode, FlowRun } from '../../core/models/flow.model';
import type { KeyValue, RequestDefinition } from '../../core/models/request.model';
import { WorkspaceStore } from '../../core/state/workspace.store';
import { formatMs } from '../../core/utils/format';
import { uid } from '../../core/utils/id';
import { executionOrder } from '../../core/utils/flow-runner';
import { IconComponent } from '../../shared/components/icon/icon.component';
import { KeyValueEditorComponent } from '../../shared/components/key-value-editor/key-value-editor.component';
import { Router } from '@angular/router';
import { RequestEditorComponent } from '../workspace/request-editor/request-editor.component';

/** Right-hand panel of the flow designer: node editor, or flow settings + run summary. */
@Component({
  selector: 'app-flow-inspector',
  imports: [IconComponent, RequestEditorComponent, KeyValueEditorComponent, KeyValuePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './flow-inspector.component.html',
  styleUrl: './flow-inspector.component.scss',
})
export class FlowInspectorComponent {
  private readonly workspace = inject(WorkspaceStore);
  private readonly router = inject(Router);
  readonly flow = input.required<Flow>();
  readonly node = input<FlowNode | null>(null);
  readonly run = input<FlowRun | null>(null);
  readonly nodeChange = output<FlowNode>();
  readonly flowChange = output<Partial<Flow>>();
  readonly removeNode = output<string>();
  readonly selectNode = output<string | null>();

  protected readonly formatMs = formatMs;
  protected readonly varSyntax = '{{name}}';
  protected readonly step = computed(() => {
    const node = this.node();
    return node ? (this.run()?.steps[node.id] ?? null) : null;
  });

  /** Variables available to the selected node: flow variables + extractions of previous steps. */
  protected readonly available = computed(() => {
    const flow = this.flow();
    const node = this.node();
    const vars = flow.variables.filter((v) => v.enabled && v.key.trim()).map((v) => v.key.trim());
    if (!node) return vars;
    let order: FlowNode[];
    try {
      order = executionOrder(flow);
    } catch {
      order = flow.nodes;
    }
    for (const n of order) {
      if (n.id === node.id) break;
      vars.push(...n.extractions.filter((e) => e.name.trim()).map((e) => e.name.trim()));
    }
    return [...new Set(vars)];
  });

  protected readonly orderedSteps = computed(() => {
    const run = this.run();
    if (!run) return [];
    const byId = new Map(this.flow().nodes.map((n) => [n.id, n]));
    return Object.values(run.steps)
      .map((s) => ({ step: s, node: byId.get(s.nodeId) }))
      .filter((s) => !!s.node)
      .sort((a, b) => {
        const ia = run.path.indexOf(a.step.nodeId);
        const ib = run.path.indexOf(b.step.nodeId);
        return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
      });
  });

  protected readonly variableEntries = computed(() => Object.entries(this.run()?.variables ?? {}));
  protected readonly totalDuration = computed(() => {
    const run = this.run();
    return run?.finishedAt ? run.finishedAt - run.startedAt : null;
  });

  private patchNode(patch: Partial<FlowNode>): void {
    const node = this.node();
    if (node) this.nodeChange.emit({ ...node, ...patch });
  }

  protected setName(name: string): void {
    this.patchNode({ name });
  }

  protected setRequest(request: RequestDefinition): void {
    this.patchNode({ request });
  }

  protected setExpected(expectedStatus: string): void {
    this.patchNode({ expectedStatus });
  }

  protected setContinue(continueOnError: boolean): void {
    this.patchNode({ continueOnError });
  }

  protected addExtraction(): void {
    const node = this.node();
    if (!node) return;
    const extraction: FlowExtraction = { id: uid(), name: '', source: 'body', syntax: 'jsonpath', expression: '$.', expectedType: 'any', required: true };
    this.patchNode({ extractions: [...node.extractions, extraction] });
  }

  protected updateExtraction(id: string, patch: Partial<FlowExtraction>): void {
    const node = this.node();
    if (node) this.patchNode({ extractions: node.extractions.map((e) => (e.id === id ? { ...e, ...patch } : e)) });
  }

  protected removeExtraction(id: string): void {
    const node = this.node();
    if (node) this.patchNode({ extractions: node.extractions.filter((e) => e.id !== id) });
  }

  protected setVariables(variables: KeyValue[]): void {
    this.flowChange.emit({ variables });
  }

  protected preview(value: unknown): string {
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    return text.length > 120 ? `${text.slice(0, 120)}…` : text;
  }

  protected async openExecution(id: string): Promise<void> {
    await this.workspace.openExecution(id);
    void this.router.navigateByUrl('/');
  }
}
