import ipaddr from 'ipaddr.js';

/**
 * Cloud metadata endpoints. Blocked even when private networks are allowed,
 * because reaching them typically leaks infrastructure credentials.
 */
const ALWAYS_BLOCKED = new Set([
  '169.254.169.254', // AWS / GCP / Azure / OpenStack
  '169.254.170.2', // AWS ECS task metadata
  '169.254.169.253', // AWS DNS
  '100.100.100.200', // Alibaba Cloud
  '192.0.0.192', // Oracle Cloud
  'fd00:ec2::254', // AWS IMDS over IPv6
]);

/** Ranges that become reachable when `allowPrivateNetworks` is enabled. */
const PRIVATE_RANGES = new Set(['private', 'loopback', 'uniqueLocal', 'linkLocal', 'carrierGradeNat']);

export interface IpVerdict {
  allowed: boolean;
  /** Normalized address (IPv4-mapped IPv6 is converted to IPv4). */
  address: string;
  range: string;
}

export class IpPolicy {
  constructor(private readonly allowPrivateNetworks = false) {}

  evaluate(rawAddress: string): IpVerdict {
    const raw = rawAddress.replace(/^\[|\]$/g, '');
    if (!ipaddr.isValid(raw)) return { allowed: false, address: raw, range: 'invalid' };

    let addr = ipaddr.parse(raw);
    if (addr.kind() === 'ipv6' && (addr as ipaddr.IPv6).isIPv4MappedAddress()) {
      addr = (addr as ipaddr.IPv6).toIPv4Address();
    }
    const address = addr.toNormalizedString();
    const canonical = addr.kind() === 'ipv6' ? (addr as ipaddr.IPv6).toString() : address;
    const range = addr.range();

    if (ALWAYS_BLOCKED.has(address) || ALWAYS_BLOCKED.has(canonical)) {
      return { allowed: false, address: canonical, range: 'cloudMetadata' };
    }
    if (range === 'unicast') return { allowed: true, address: canonical, range };
    if (this.allowPrivateNetworks && PRIVATE_RANGES.has(range)) {
      return { allowed: true, address: canonical, range };
    }
    return { allowed: false, address: canonical, range };
  }

  isAllowed(address: string): boolean {
    return this.evaluate(address).allowed;
  }
}
