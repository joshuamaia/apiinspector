import { Injectable, computed, inject, signal } from '@angular/core';
import type { ExecutionRecord } from '../models/execution.model';
import type { RequestDefinition } from '../models/request.model';
import { HistoryStore } from '../state/history.store';
import { uid } from '../utils/id';
import type { Variables } from '../utils/interpolate';
import { RequestBuildError, stripSecrets, toProxyPayload } from '../utils/request';
import { requestKeyOf } from '../utils/url';
import { ApiService } from './api.service';

export interface ExecuteOptions {
  name: string;
  requestId?: string | null;
  variables?: Variables;
  signal?: AbortSignal;
  /** Store the execution in the history (default true). */
  record?: boolean;
}

/**
 * Executes a request through the BFF and turns the outcome into an
 * `ExecutionRecord`. Secrets are stripped from the stored request snapshot.
 */
@Injectable({ providedIn: 'root' })
export class ExecutionService {
  private readonly api = inject(ApiService);
  private readonly history = inject(HistoryStore);
  private readonly inFlight = signal(0);
  readonly running = computed(() => this.inFlight() > 0);

  async execute(def: RequestDefinition, options: ExecuteOptions): Promise<ExecutionRecord> {
    const base = {
      id: uid(),
      createdAt: Date.now(),
      requestId: options.requestId ?? null,
      name: options.name,
      request: stripSecrets(def),
      requestKey: options.requestId ?? requestKeyOf(def.method, def.url),
    };

    let payload;
    try {
      payload = toProxyPayload(def, options.variables);
    } catch (err) {
      const message = err instanceof RequestBuildError ? err.message : (err as Error).message;
      // Invalid input never reaches the network and is not recorded.
      return { ...base, outcome: 'error', durationMs: 0, error: { kind: 'INVALID_URL', message, statusCode: 0 } };
    }

    this.inFlight.update((n) => n + 1);
    let record: ExecutionRecord;
    try {
      const result = await this.api.execute(payload, options.signal);
      if (result.ok) {
        const { data } = result;
        record = {
          ...base,
          createdAt: new Date(data.startedAt).getTime() || base.createdAt,
          outcome: 'response',
          durationMs: data.timings.total,
          status: data.response.status,
          response: data.response,
          timings: data.timings,
          requestHeaders: data.request.headers,
          droppedHeaders: data.request.droppedHeaders,
          virtual: data.virtual,
        };
      } else {
        record = { ...base, outcome: 'error', durationMs: result.elapsedMs, error: result.error };
      }
    } finally {
      this.inFlight.update((n) => n - 1);
    }

    const skip = record.error && ['CANCELLED', 'BFF_UNREACHABLE', 'VALIDATION', 'RATE_LIMITED', 'CONCURRENCY_LIMIT', 'UNAUTHORIZED'].includes(record.error.kind);
    if (options.record !== false && !skip) await this.history.add(record);
    return record;
  }
}
