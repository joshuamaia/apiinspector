import { ProxyError } from '../errors/proxy-error.js';
import { ConcurrencyLimiter } from './concurrency-limiter.js';

describe('ConcurrencyLimiter', () => {
  it('enforces the per-client limit', () => {
    const limiter = new ConcurrencyLimiter(10, 2);
    const r1 = limiter.acquire('a');
    limiter.acquire('a');
    expect(() => limiter.acquire('a')).toThrow(ProxyError);
    expect(() => limiter.acquire('b')).not.toThrow();
    r1();
    expect(() => limiter.acquire('a')).not.toThrow();
  });

  it('enforces the global limit', () => {
    const limiter = new ConcurrencyLimiter(2, 5);
    limiter.acquire('a');
    limiter.acquire('b');
    expect(() => limiter.acquire('c')).toThrow(/busy/);
  });

  it('release is idempotent', () => {
    const limiter = new ConcurrencyLimiter(1, 1);
    const release = limiter.acquire('a');
    release();
    release();
    expect(limiter.inFlight).toBe(0);
  });
});
