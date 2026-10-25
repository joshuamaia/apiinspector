import { ProxyError } from '../errors/proxy-error.js';

/**
 * Non-queuing semaphore with a global and a per-client limit. Requests over
 * the limit are rejected immediately instead of piling up in memory.
 */
export class ConcurrencyLimiter {
  private active = 0;
  private readonly perClient = new Map<string, number>();

  constructor(
    private readonly maxGlobal: number,
    private readonly maxPerClient: number,
  ) {}

  get inFlight(): number {
    return this.active;
  }

  acquire(clientKey: string): () => void {
    const current = this.perClient.get(clientKey) ?? 0;
    if (this.active >= this.maxGlobal) {
      throw new ProxyError('CONCURRENCY_LIMIT', 'The proxy is busy. Try again in a moment.', { limit: this.maxGlobal });
    }
    if (current >= this.maxPerClient) {
      throw new ProxyError('CONCURRENCY_LIMIT', `Too many simultaneous requests (limit ${this.maxPerClient} per client)`, {
        limit: this.maxPerClient,
      });
    }
    this.active++;
    this.perClient.set(clientKey, current + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active--;
      const remaining = (this.perClient.get(clientKey) ?? 1) - 1;
      if (remaining <= 0) this.perClient.delete(clientKey);
      else this.perClient.set(clientKey, remaining);
    };
  }
}
