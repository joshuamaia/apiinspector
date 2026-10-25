import dns, { type LookupAddress } from 'node:dns';
import { ProxyError } from '../errors/proxy-error.js';
import { IpPolicy } from './ip-policy.js';

/** Resolver signature compatible with `dns.lookup(hostname, { all: true }, cb)`. */
export type Resolver = (
  hostname: string,
  options: { all: true; family?: number },
  callback: (err: NodeJS.ErrnoException | null, addresses: LookupAddress[]) => void,
) => void;

export const defaultResolver: Resolver = (hostname, options, callback) =>
  dns.lookup(hostname, { ...options, all: true, verbatim: true }, callback);

type LookupCallback = (
  err: NodeJS.ErrnoException | null,
  address: string | LookupAddress[],
  family?: number,
) => void;

/**
 * Builds a `lookup` function for `http.request`. Every resolved address is
 * validated and the socket connects to exactly the validated address, which
 * closes the time-of-check/time-of-use window exploited by DNS rebinding.
 * If ANY address of the answer is forbidden the whole lookup is rejected.
 */
export function createSafeLookup(policy: IpPolicy, resolver: Resolver = defaultResolver, onResolved?: (address: string) => void) {
  return (hostname: string, options: { all?: boolean; family?: number } | number, callback: LookupCallback): void => {
    const opts = typeof options === 'number' ? { family: options } : (options ?? {});
    resolver(hostname, { all: true, family: opts.family || undefined }, (err, addresses) => {
      if (err) return callback(err, opts.all ? [] : '', 4);
      if (!addresses?.length) {
        const notFound = Object.assign(new Error(`getaddrinfo ENOTFOUND ${hostname}`), { code: 'ENOTFOUND' });
        return callback(notFound, opts.all ? [] : '', 4);
      }
      for (const entry of addresses) {
        const verdict = policy.evaluate(entry.address);
        if (!verdict.allowed) {
          const blocked = new ProxyError(
            'BLOCKED_DESTINATION',
            `Host "${hostname}" resolves to ${verdict.address} (${verdict.range}), which is not allowed`,
            { hostname, address: verdict.address, range: verdict.range },
          );
          return callback(blocked as unknown as NodeJS.ErrnoException, opts.all ? [] : '', 4);
        }
      }
      onResolved?.(addresses[0].address);
      if (opts.all) return callback(null, addresses);
      return callback(null, addresses[0].address, addresses[0].family);
    });
  };
}
