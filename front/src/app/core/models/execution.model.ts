import type { ProxyErrorInfo, ProxyResponseData, Timings } from './proxy.model';
import type { RequestDefinition } from './request.model';

/** Result of executing a request: either an HTTP response or a transport error. */
export interface ExecutionRecord {
  id: string;
  createdAt: number;
  /** Saved request this execution belongs to (if any). */
  requestId: string | null;
  name: string;
  /** Snapshot of the request with secrets removed. */
  request: RequestDefinition;
  /** Grouping key used by metrics when there is no saved request id. */
  requestKey: string;
  outcome: 'response' | 'error';
  durationMs: number;
  status?: number;
  response?: ProxyResponseData;
  /** true when the body was cut before being stored locally. */
  storedBodyTruncated?: boolean;
  timings?: Timings;
  requestHeaders?: [string, string][];
  droppedHeaders?: { key: string; reason: string }[];
  virtual?: boolean;
  error?: ProxyErrorInfo;
}

export function isHttpSuccess(record: Pick<ExecutionRecord, 'outcome' | 'status'>): boolean {
  return record.outcome === 'response' && (record.status ?? 0) >= 200 && (record.status ?? 0) < 400;
}
