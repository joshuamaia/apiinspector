import { Injectable, inject, signal } from '@angular/core';
import type { Flow } from '../../core/models/flow.model';
import { ExecutionService } from '../../core/services/execution.service';
import { FlowsStore } from '../../core/state/flows.store';
import { runFlow, type StepExecutor } from '../../core/utils/flow-runner';
import { interpolate } from '../../core/utils/interpolate';

/** Runs flows through the BFF, recording every step in history. */
@Injectable({ providedIn: 'root' })
export class FlowRunnerService {
  private readonly executor = inject(ExecutionService);
  private readonly store = inject(FlowsStore);
  private controller: AbortController | null = null;
  readonly runningFlowId = signal<string | null>(null);

  async run(flow: Flow): Promise<void> {
    if (this.runningFlowId()) return;
    this.controller = new AbortController();
    this.runningFlowId.set(flow.id);

    const execute: StepExecutor = async (node, request, vars, signal) => {
      const record = await this.executor.execute(request, { name: `${flow.name} › ${node.name}`, variables: vars, signal });
      const resolvedUrl = record.response?.finalUrl ?? interpolate(request.url, vars);
      if (record.outcome === 'response' && record.response) {
        const body = record.response.bodyEncoding === 'utf8' ? record.response.body : '';
        return { kind: 'response', status: record.status!, headers: record.response.headers, body, durationMs: record.durationMs, resolvedUrl, executionId: record.id };
      }
      return { kind: 'error', message: `${record.error?.kind}: ${record.error?.message}`, durationMs: record.durationMs, resolvedUrl, executionId: record.id };
    };

    try {
      await runFlow(flow, execute, (run) => this.store.setRun(run), this.controller.signal);
    } catch (err) {
      this.store.setRun({
        flowId: flow.id,
        startedAt: Date.now(),
        finishedAt: Date.now(),
        status: 'failed',
        steps: {},
        variables: {},
        path: [],
      });
      throw err;
    } finally {
      this.runningFlowId.set(null);
      this.controller = null;
    }
  }

  stop(): void {
    this.controller?.abort();
  }
}
