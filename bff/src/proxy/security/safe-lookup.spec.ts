import type { LookupAddress } from 'node:dns';
import { ProxyError } from '../errors/proxy-error.js';
import { IpPolicy } from './ip-policy.js';
import { createSafeLookup, type Resolver } from './safe-lookup.js';

const fakeResolver =
  (addresses: string[]): Resolver =>
  (_hostname, _options, callback) =>
    callback(
      null,
      addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }) as LookupAddress),
    );

function lookupAsync(lookup: ReturnType<typeof createSafeLookup>, all: boolean) {
  return new Promise<{ err: unknown; address: unknown; family?: number }>((resolve) =>
    lookup('target.test', { all }, (err, address, family) => resolve({ err, address, family })),
  );
}

describe('createSafeLookup', () => {
  const policy = new IpPolicy(false);

  it('returns the validated public address', async () => {
    const result = await lookupAsync(createSafeLookup(policy, fakeResolver(['93.184.216.34'])), false);
    expect(result.err).toBeNull();
    expect(result.address).toBe('93.184.216.34');
    expect(result.family).toBe(4);
  });

  it('supports the `all: true` form used by happy eyeballs', async () => {
    const result = await lookupAsync(createSafeLookup(policy, fakeResolver(['93.184.216.34', '2606:2800:220:1::'])), true);
    expect(result.err).toBeNull();
    expect(result.address).toHaveLength(2);
  });

  it('rejects hosts that resolve to private addresses (DNS rebinding)', async () => {
    const result = await lookupAsync(createSafeLookup(policy, fakeResolver(['127.0.0.1'])), false);
    expect(result.err).toBeInstanceOf(ProxyError);
    expect((result.err as ProxyError).kind).toBe('BLOCKED_DESTINATION');
  });

  it('rejects the whole answer when any address is forbidden', async () => {
    const result = await lookupAsync(createSafeLookup(policy, fakeResolver(['93.184.216.34', '10.0.0.5'])), true);
    expect((result.err as ProxyError).kind).toBe('BLOCKED_DESTINATION');
  });

  it('propagates resolver errors and empty answers as ENOTFOUND', async () => {
    const failing: Resolver = (_h, _o, cb) => cb(Object.assign(new Error('nope'), { code: 'ENOTFOUND' }), []);
    const r1 = await lookupAsync(createSafeLookup(policy, failing), false);
    expect((r1.err as NodeJS.ErrnoException).code).toBe('ENOTFOUND');
    const r2 = await lookupAsync(createSafeLookup(policy, fakeResolver([])), false);
    expect((r2.err as NodeJS.ErrnoException).code).toBe('ENOTFOUND');
  });
});
