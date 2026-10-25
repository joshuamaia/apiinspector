import type { Flow, FlowNode, FlowRun, FlowStepResult } from '../models/flow.model';
import type { RequestDefinition } from '../models/request.model';
import { extractValue, matchesExpectedStatus } from './extract';
import type { Variables } from './interpolate';

export type StepOutcome =
  | { kind: 'response'; status: number; headers: [string, string][]; body: string; durationMs: number; resolvedUrl: string; executionId?: string }
  | { kind: 'error'; message: string; durationMs: number; resolvedUrl?: string; executionId?: string };

export type StepExecutor = (node: FlowNode, request: RequestDefinition, vars: Variables, signal: AbortSignal) => Promise<StepOutcome>;

export class FlowCycleError extends Error {}

/** Topological order (Kahn). Ties are broken by visual position (top-to-bottom, left-to-right). */
export function executionOrder(flow: Pick<Flow, 'nodes' | 'edges'>): FlowNode[] {
  const byId = new Map(flow.nodes.map((n) => [n.id, n]));
  const indegree = new Map(flow.nodes.map((n) => [n.id, 0]));
  for (const e of flow.edges) if (byId.has(e.from) && byId.has(e.to)) indegree.set(e.to, (indegree.get(e.to) ?? 0) + 1);
  const visual = (a: FlowNode, b: FlowNode) => a.y - b.y || a.x - b.x;
  let ready = flow.nodes.filter((n) => indegree.get(n.id) === 0).sort(visual);
  const order: FlowNode[] = [];
  while (ready.length) {
    const node = ready.shift()!;
    order.push(node);
    for (const e of flow.edges.filter((edge) => edge.from === node.id)) {
      const d = (indegree.get(e.to) ?? 0) - 1;
      indegree.set(e.to, d);
      if (d === 0 && byId.has(e.to)) ready = [...ready, byId.get(e.to)!].sort(visual);
    }
  }
  if (order.length !== flow.nodes.length) throw new FlowCycleError('The flow contains a cycle; remove a connection to run it');
  return order;
}

function preview(body: string): string {
  return body.length > 4000 ? `${body.slice(0, 4000)}…` : body;
}

/**
 * Runs a flow sequentially. Each step can read variables produced by previous
 * steps (`{{name}}`). A failed step skips its dependants and, when
 * `stopOnError` is set (and the step does not allow continuing), stops the run.
 */
export async function runFlow(flow: Flow, execute: StepExecutor, onUpdate: (run: FlowRun) => void, signal: AbortSignal): Promise<FlowRun> {
  const order = executionOrder(flow);
  const variables: Variables = {};
  for (const v of flow.variables) if (v.enabled && v.key.trim()) variables[v.key.trim()] = v.value;

  const run: FlowRun = {
    flowId: flow.id,
    startedAt: Date.now(),
    status: 'running',
    steps: Object.fromEntries(order.map((n) => [n.id, { nodeId: n.id, status: 'pending', extracted: {}, extractionErrors: [] } as FlowStepResult])),
    variables: { ...variables },
    path: [],
  };
  const emit = () => onUpdate(structuredClone(run));
  emit();

  const failed = new Set<string>();
  let stopped = false;

  for (const node of order) {
    const step = run.steps[node.id];
    if (signal.aborted) {
      run.status = 'cancelled';
      break;
    }
    const blockedBy = flow.edges.filter((e) => e.to === node.id && failed.has(e.from));
    if (stopped || blockedBy.length > 0) {
      step.status = 'skipped';
      step.error = stopped ? 'Flow stopped after a failure' : 'Skipped because a previous step failed';
      failed.add(node.id);
      emit();
      continue;
    }

    step.status = 'running';
    run.path.push(node.id);
    emit();

    let outcome: StepOutcome;
    try {
      outcome = await execute(node, node.request, { ...variables }, signal);
    } catch (err) {
      outcome = { kind: 'error', message: (err as Error).message, durationMs: 0 };
    }
    step.durationMs = outcome.durationMs;
    step.resolvedUrl = outcome.resolvedUrl;
    step.executionId = outcome.executionId;

    let ok: boolean;
    if (outcome.kind === 'error') {
      ok = false;
      step.error = outcome.message;
    } else {
      step.httpStatus = outcome.status;
      step.responsePreview = preview(outcome.body);
      ok = matchesExpectedStatus(outcome.status, node.expectedStatus);
      if (!ok) step.error = `Unexpected status ${outcome.status}${node.expectedStatus ? ` (expected ${node.expectedStatus})` : ''}`;
      for (const extraction of node.extractions) {
        if (!extraction.name.trim()) continue;
        const result = extractValue(outcome, extraction);
        if (result.ok) {
          if (result.value !== undefined) {
            variables[extraction.name.trim()] = result.value;
            step.extracted[extraction.name.trim()] = result.value;
          }
        } else {
          step.extractionErrors.push(`${extraction.name}: ${result.error}`);
          ok = false;
        }
      }
      if (step.extractionErrors.length && !step.error) step.error = 'Variable extraction failed';
    }

    if (signal.aborted) {
      step.status = 'failed';
      step.error = 'Cancelled';
      run.status = 'cancelled';
      emit();
      break;
    }

    step.status = ok ? 'success' : 'failed';
    run.variables = { ...variables };
    if (!ok && !node.continueOnError) {
      failed.add(node.id);
      if (flow.stopOnError) stopped = true;
    }
    emit();
  }

  if (run.status === 'running') {
    run.status = Object.values(run.steps).some((s) => s.status === 'failed') ? 'failed' : 'success';
  }
  for (const s of Object.values(run.steps)) if (s.status === 'pending') s.status = 'skipped';
  run.finishedAt = Date.now();
  emit();
  return run;
}
