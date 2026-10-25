import { Injectable, computed, inject, signal } from '@angular/core';
import type { Flow, FlowNode, FlowRun } from '../models/flow.model';
import type { RequestDefinition } from '../models/request.model';
import { DbService, type StoredFlow } from '../services/db.service';
import { SecretVaultService } from '../services/secret-vault.service';
import { uid } from '../utils/id';
import { createRequest } from '../utils/request';

/** Visual flows. Node requests are sealed (secrets encrypted) when persisted. */
@Injectable({ providedIn: 'root' })
export class FlowsStore {
  private readonly db = inject(DbService);
  private readonly vault = inject(SecretVaultService);
  readonly flows = signal<Flow[]>([]);
  readonly selectedId = signal<string | null>(null);
  readonly selected = computed(() => this.flows().find((f) => f.id === this.selectedId()) ?? null);
  /** Last run per flow (in memory). */
  readonly runs = signal<Record<string, FlowRun>>({});
  private persistTimers = new Map<string, ReturnType<typeof setTimeout>>();

  async load(): Promise<void> {
    const stored = await this.db.all('flows');
    const flows: Flow[] = [];
    for (const s of stored) flows.push(await this.unseal(s));
    flows.sort((a, b) => a.createdAt - b.createdAt);
    this.flows.set(flows);
    if (!this.selectedId() && flows.length) this.selectedId.set(flows[0].id);
  }

  private async unseal(stored: StoredFlow): Promise<Flow> {
    const { secrets, ...flow } = stored;
    const defs = await this.vault.unsealMany(Object.fromEntries(flow.nodes.map((n) => [n.id, n.request])), secrets);
    return { ...flow, nodes: flow.nodes.map((n) => ({ ...n, request: defs[n.id] ?? n.request })) };
  }

  private async persist(flow: Flow): Promise<void> {
    const { defs, secrets } = await this.vault.sealMany(Object.fromEntries(flow.nodes.map((n) => [n.id, n.request])));
    const stored: StoredFlow = { ...structuredClone(flow), nodes: flow.nodes.map((n) => ({ ...structuredClone(n), request: defs[n.id] })), secrets };
    await this.db.put('flows', stored);
  }

  /** Updates a flow in memory immediately and persists it (debounced). */
  update(id: string, mutate: (flow: Flow) => Flow): void {
    let updated: Flow | null = null;
    this.flows.update((list) =>
      list.map((f) => {
        if (f.id !== id) return f;
        updated = { ...mutate(f), updatedAt: Date.now() };
        return updated;
      }),
    );
    if (!updated) return;
    const flow: Flow = updated;
    clearTimeout(this.persistTimers.get(id));
    this.persistTimers.set(
      id,
      setTimeout(() => void this.persist(flow), 300),
    );
  }

  async create(name = 'New flow'): Promise<Flow> {
    const now = Date.now();
    const flow: Flow = { id: uid(), name, description: '', nodes: [], edges: [], variables: [], stopOnError: true, createdAt: now, updatedAt: now };
    await this.persist(flow);
    this.flows.update((list) => [...list, flow]);
    this.selectedId.set(flow.id);
    return flow;
  }

  async upsert(flow: Flow): Promise<void> {
    await this.persist(flow);
    this.flows.update((list) => (list.some((f) => f.id === flow.id) ? list.map((f) => (f.id === flow.id ? flow : f)) : [...list, flow]));
    if (!this.selectedId()) this.selectedId.set(flow.id);
  }

  async duplicate(id: string): Promise<void> {
    const source = this.flows().find((f) => f.id === id);
    if (!source) return;
    const idMap = new Map(source.nodes.map((n) => [n.id, uid()]));
    const now = Date.now();
    const copy: Flow = {
      ...structuredClone(source),
      id: uid(),
      name: `${source.name} (copy)`,
      demo: undefined,
      createdAt: now,
      updatedAt: now,
      nodes: source.nodes.map((n) => ({ ...structuredClone(n), id: idMap.get(n.id)! })),
      edges: source.edges.map((e) => ({ id: uid(), from: idMap.get(e.from)!, to: idMap.get(e.to)! })),
    };
    await this.upsert(copy);
    this.selectedId.set(copy.id);
  }

  async remove(id: string): Promise<void> {
    await this.db.delete('flows', id);
    this.flows.update((list) => list.filter((f) => f.id !== id));
    if (this.selectedId() === id) this.selectedId.set(this.flows()[0]?.id ?? null);
  }

  newNode(x: number, y: number, request: RequestDefinition = createRequest({ url: 'https://' })): FlowNode {
    return { id: uid(), name: `${request.method} request`, x, y, request, extractions: [], expectedStatus: '2xx', continueOnError: false };
  }

  setRun(run: FlowRun): void {
    this.runs.update((r) => ({ ...r, [run.flowId]: run }));
  }
}
