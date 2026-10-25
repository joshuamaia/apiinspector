import { CdkDrag, type CdkDragEnd, type CdkDragMove } from '@angular/cdk/drag-drop';
import { CdkMenu, CdkMenuItem, CdkMenuTrigger } from '@angular/cdk/menu';
import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, signal, viewChild } from '@angular/core';
import type { Flow, FlowEdge, FlowNode, StepStatus } from '../../core/models/flow.model';
import { ImportExportService } from '../../core/services/import-export.service';
import { ToastService } from '../../core/services/toast.service';
import { CollectionsStore } from '../../core/state/collections.store';
import { FlowsStore } from '../../core/state/flows.store';
import { executionOrder, FlowCycleError } from '../../core/utils/flow-runner';
import { formatMs } from '../../core/utils/format';
import { uid } from '../../core/utils/id';
import { createRequest } from '../../core/utils/request';
import { ConfirmService } from '../../shared/components/dialogs/confirm-dialog.component';
import { IconComponent } from '../../shared/components/icon/icon.component';
import { FlowInspectorComponent } from './flow-inspector.component';
import { FlowRunnerService } from './flow-runner.service';

const NODE_W = 250;
const NODE_H = 66;
const GRID = 10;

interface Point {
  x: number;
  y: number;
}

@Component({
  selector: 'app-flows-page',
  imports: [IconComponent, CdkDrag, CdkMenu, CdkMenuItem, CdkMenuTrigger, FlowInspectorComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './flows-page.component.html',
  styleUrl: './flows-page.component.scss',
  host: { '(document:keydown)': 'onKeydown($event)' },
})
export class FlowsPageComponent {
  protected readonly store = inject(FlowsStore);
  protected readonly runner = inject(FlowRunnerService);
  protected readonly collections = inject(CollectionsStore);
  private readonly importExport = inject(ImportExportService);
  private readonly confirm = inject(ConfirmService);
  private readonly toast = inject(ToastService);
  private readonly canvasEl = viewChild<ElementRef<HTMLElement>>('canvas');

  protected readonly NODE_W = NODE_W;
  protected readonly NODE_H = NODE_H;
  protected readonly formatMs = formatMs;

  protected readonly selectedNodeId = signal<string | null>(null);
  protected readonly selectedEdgeId = signal<string | null>(null);
  protected readonly connectFrom = signal<string | null>(null);
  protected readonly pointer = signal<Point>({ x: 0, y: 0 });
  private readonly live = signal<Record<string, Point>>({});

  protected readonly flow = this.store.selected;
  protected readonly run = computed(() => {
    const flow = this.flow();
    return flow ? (this.store.runs()[flow.id] ?? null) : null;
  });
  protected readonly running = computed(() => !!this.flow() && this.runner.runningFlowId() === this.flow()!.id);
  protected readonly selectedNode = computed(() => this.flow()?.nodes.find((n) => n.id === this.selectedNodeId()) ?? null);

  private pos(node: FlowNode): Point {
    return this.live()[node.id] ?? { x: node.x, y: node.y };
  }

  protected readonly canvasSize = computed(() => {
    const nodes = this.flow()?.nodes ?? [];
    const maxX = Math.max(0, ...nodes.map((n) => this.pos(n).x + NODE_W));
    const maxY = Math.max(0, ...nodes.map((n) => this.pos(n).y + NODE_H));
    return { w: Math.max(1100, maxX + 360), h: Math.max(720, maxY + 260) };
  });

  protected readonly edges = computed(() => {
    const flow = this.flow();
    if (!flow) return [];
    const byId = new Map(flow.nodes.map((n) => [n.id, n]));
    const run = this.run();
    return flow.edges
      .filter((e) => byId.has(e.from) && byId.has(e.to))
      .map((e) => {
        const a = this.pos(byId.get(e.from)!);
        const b = this.pos(byId.get(e.to)!);
        const x1 = a.x + NODE_W / 2;
        const y1 = a.y + NODE_H;
        const x2 = b.x + NODE_W / 2;
        const y2 = b.y;
        const dy = Math.max(40, Math.abs(y2 - y1) / 2);
        const target = run?.steps[e.to]?.status;
        const source = run?.steps[e.from]?.status;
        const state: StepStatus | 'idle' = source === 'success' && target && target !== 'pending' ? target : 'idle';
        return { edge: e, path: `M ${x1} ${y1} C ${x1} ${y1 + dy}, ${x2} ${y2 - dy}, ${x2} ${y2}`, mid: { x: (x1 + x2) / 2, y: (y1 + y2) / 2 }, state };
      });
  });

  protected readonly pendingPath = computed(() => {
    const from = this.connectFrom();
    const flow = this.flow();
    if (!from || !flow) return null;
    const node = flow.nodes.find((n) => n.id === from);
    if (!node) return null;
    const a = this.pos(node);
    const x1 = a.x + NODE_W / 2;
    const y1 = a.y + NODE_H;
    const { x: x2, y: y2 } = this.pointer();
    const dy = Math.max(30, Math.abs(y2 - y1) / 2);
    return `M ${x1} ${y1} C ${x1} ${y1 + dy}, ${x2} ${y2 - dy}, ${x2} ${y2}`;
  });

  protected readonly orderIndex = computed(() => {
    const flow = this.flow();
    if (!flow) return new Map<string, number>();
    try {
      return new Map(executionOrder(flow).map((n, i) => [n.id, i + 1]));
    } catch {
      return new Map<string, number>();
    }
  });

  protected stepStatus(node: FlowNode): StepStatus | null {
    return this.run()?.steps[node.id]?.status ?? null;
  }

  protected stepInfo(node: FlowNode) {
    return this.run()?.steps[node.id] ?? null;
  }

  protected extractionNames(node: FlowNode): string {
    return node.extractions.map((x) => x.name).join(', ');
  }

  protected hostOf(url: string): string {
    const clean = url.replace(/\{\{\s*baseUrl\s*\}\}/, '');
    return clean.length > 38 ? `${clean.slice(0, 38)}…` : clean || '(no URL)';
  }

  // ---- flow management ----
  protected select(id: string): void {
    this.store.selectedId.set(id);
    this.selectedNodeId.set(null);
    this.selectedEdgeId.set(null);
  }

  protected async newFlow(): Promise<void> {
    const name = await this.confirm.prompt('New flow', 'Name', 'My flow', 'Create');
    if (name) {
      await this.store.create(name);
      this.selectedNodeId.set(null);
    }
  }

  protected async deleteFlow(): Promise<void> {
    const flow = this.flow();
    if (flow && (await this.confirm.confirm({ title: 'Delete flow', message: `Delete "${flow.name}"?`, danger: true, confirmLabel: 'Delete' }))) {
      await this.store.remove(flow.id);
    }
  }

  protected async loadDemo(): Promise<void> {
    await this.importExport.loadDemo();
    this.store.selectedId.set('demo-flow-login');
    this.toast.success('Demo flow loaded');
  }

  protected patchFlow(patch: Partial<Flow>): void {
    const flow = this.flow();
    if (flow) this.store.update(flow.id, (f) => ({ ...f, ...patch }));
  }

  // ---- nodes ----
  private nextPosition(): Point {
    const nodes = this.flow()?.nodes ?? [];
    if (!nodes.length) return { x: 300, y: 40 };
    const last = [...nodes].sort((a, b) => b.y - a.y)[0];
    return { x: last.x, y: last.y + NODE_H + 70 };
  }

  protected addNode(): void {
    const flow = this.flow();
    if (!flow) return;
    const p = this.nextPosition();
    const node = this.store.newNode(p.x, p.y, createRequest({ url: '{{baseUrl}}/' }));
    const lastId = this.lastNodeId();
    this.store.update(flow.id, (f) => ({ ...f, nodes: [...f.nodes, node], edges: lastId ? [...f.edges, { id: uid(), from: lastId, to: node.id }] : f.edges }));
    this.selectedNodeId.set(node.id);
  }

  protected async addFromCollection(requestId: string): Promise<void> {
    const flow = this.flow();
    const opened = await this.collections.openRequest(requestId);
    if (!flow || !opened) return;
    const p = this.nextPosition();
    const node: FlowNode = { ...this.store.newNode(p.x, p.y, opened.def), name: opened.saved.name };
    const lastId = this.lastNodeId();
    this.store.update(flow.id, (f) => ({ ...f, nodes: [...f.nodes, node], edges: lastId ? [...f.edges, { id: uid(), from: lastId, to: node.id }] : f.edges }));
    this.selectedNodeId.set(node.id);
  }

  private lastNodeId(): string | null {
    const flow = this.flow();
    if (!flow?.nodes.length) return null;
    try {
      return executionOrder(flow).at(-1)?.id ?? null;
    } catch {
      return null;
    }
  }

  protected updateNode(node: FlowNode): void {
    const flow = this.flow();
    if (flow) this.store.update(flow.id, (f) => ({ ...f, nodes: f.nodes.map((n) => (n.id === node.id ? node : n)) }));
  }

  protected removeNode(id: string): void {
    const flow = this.flow();
    if (!flow) return;
    this.store.update(flow.id, (f) => ({ ...f, nodes: f.nodes.filter((n) => n.id !== id), edges: f.edges.filter((e) => e.from !== id && e.to !== id) }));
    if (this.selectedNodeId() === id) this.selectedNodeId.set(null);
  }

  protected selectNode(id: string | null): void {
    this.selectedNodeId.set(id);
    this.selectedEdgeId.set(null);
  }

  protected dragMoved(node: FlowNode, event: CdkDragMove): void {
    this.live.update((l) => ({ ...l, [node.id]: event.source.getFreeDragPosition() }));
  }

  protected dragEnded(node: FlowNode, event: CdkDragEnd): void {
    const p = event.source.getFreeDragPosition();
    const snapped = { x: Math.max(0, Math.round(p.x / GRID) * GRID), y: Math.max(0, Math.round(p.y / GRID) * GRID) };
    this.updateNode({ ...node, ...snapped });
    this.live.update((l) => {
      const copy = { ...l };
      delete copy[node.id];
      return copy;
    });
  }

  // ---- edges ----
  protected startConnect(nodeId: string, event: MouseEvent): void {
    event.stopPropagation();
    this.connectFrom.set(this.connectFrom() === nodeId ? null : nodeId);
    this.trackPointer(event);
  }

  protected finishConnect(targetId: string, event: MouseEvent): void {
    event.stopPropagation();
    const from = this.connectFrom();
    const flow = this.flow();
    this.connectFrom.set(null);
    if (!from || !flow || from === targetId) return;
    if (flow.edges.some((e) => e.from === from && e.to === targetId)) return;
    const edge: FlowEdge = { id: uid(), from, to: targetId };
    try {
      executionOrder({ nodes: flow.nodes, edges: [...flow.edges, edge] });
    } catch (err) {
      if (err instanceof FlowCycleError) {
        this.toast.error('That connection would create a cycle');
        return;
      }
      throw err;
    }
    this.store.update(flow.id, (f) => ({ ...f, edges: [...f.edges, edge] }));
  }

  protected removeEdge(id: string): void {
    const flow = this.flow();
    if (flow) this.store.update(flow.id, (f) => ({ ...f, edges: f.edges.filter((e) => e.id !== id) }));
    this.selectedEdgeId.set(null);
  }

  protected trackPointer(event: MouseEvent): void {
    const el = this.canvasEl()?.nativeElement;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    this.pointer.set({ x: event.clientX - rect.left, y: event.clientY - rect.top });
  }

  protected canvasClick(): void {
    this.connectFrom.set(null);
    this.selectedEdgeId.set(null);
    this.selectedNodeId.set(null);
  }

  // ---- run ----
  protected async runFlow(): Promise<void> {
    const flow = this.flow();
    if (!flow) return;
    if (!flow.nodes.length) {
      this.toast.show('Add at least one step to run the flow', 'warning');
      return;
    }
    try {
      await this.runner.run(flow);
      const run = this.run();
      if (run?.status === 'success') this.toast.success('Flow completed successfully');
      else if (run?.status === 'failed') {
        const failed = Object.values(run.steps).find((s) => s.status === 'failed');
        if (failed) this.selectedNodeId.set(failed.nodeId);
        this.toast.error('Flow failed — the failing step is highlighted');
      }
    } catch (err) {
      this.toast.error((err as Error).message);
    }
  }

  protected onKeydown(event: KeyboardEvent): void {
    const target = event.target as HTMLElement;
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable || target.closest('.monaco-editor')) return;
    if (event.key === 'Escape') this.connectFrom.set(null);
    if (event.key === 'Delete' || event.key === 'Backspace') {
      if (this.selectedEdgeId()) this.removeEdge(this.selectedEdgeId()!);
      else if (this.selectedNodeId()) this.removeNode(this.selectedNodeId()!);
    }
  }
}
