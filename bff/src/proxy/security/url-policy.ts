import { isIP } from 'node:net';
import { ProxyError } from '../errors/proxy-error.js';
import { IpPolicy } from './ip-policy.js';

/** Ports blocked by browsers (Fetch "bad ports"): avoids talking to SMTP, SSH, etc. */
export const BAD_PORTS = new Set([
  1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79, 87, 95, 101, 102, 103, 104, 109, 110,
  111, 113, 115, 117, 119, 123, 135, 137, 139, 143, 161, 179, 389, 427, 465, 512, 513, 514, 515, 526, 530, 531, 532,
  540, 548, 554, 556, 563, 587, 601, 636, 989, 990, 993, 995, 1719, 1720, 1723, 2049, 3659, 4045, 4190, 5060, 5061,
  6000, 6566, 6665, 6666, 6667, 6668, 6669, 6679, 6697, 10080,
]);

/** Hostnames that point to cloud metadata services or to the local machine. */
const METADATA_HOSTS = new Set(['metadata', 'metadata.google.internal', 'metadata.goog', 'instance-data', 'instance-data.ec2.internal']);
const LOCAL_SUFFIXES = ['localhost', '.localhost', '.local', '.internal', '.home.arpa', '.lan'];

export interface UrlPolicyOptions {
  allowPrivateNetworks: boolean;
  blockedHosts: string[];
  allowedHosts: string[];
}

function matchesHost(hostname: string, rule: string): boolean {
  if (rule.startsWith('.')) return hostname.endsWith(rule) || hostname === rule.slice(1);
  return hostname === rule;
}

/** Parses a user supplied URL, throwing `INVALID_URL` with a friendly message. */
export function parseTargetUrl(raw: string): URL {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) throw new ProxyError('INVALID_URL', 'URL is required');
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new ProxyError('INVALID_URL', `Invalid URL: "${trimmed.slice(0, 200)}"`);
  }
  return url;
}

export class UrlPolicy {
  private readonly ipPolicy: IpPolicy;

  constructor(private readonly options: UrlPolicyOptions) {
    this.ipPolicy = new IpPolicy(options.allowPrivateNetworks);
  }

  get ips(): IpPolicy {
    return this.ipPolicy;
  }

  /**
   * Validates protocol, credentials, port and hostname. IP literals are checked
   * here because Node.js skips the DNS lookup hook for them; hostnames are
   * checked again at connection time by the safe lookup.
   */
  assertAllowed(url: URL): void {
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new ProxyError('INVALID_URL', `Protocol "${url.protocol}" is not allowed. Only http and https are supported.`);
    }
    if (url.username || url.password) {
      throw new ProxyError('INVALID_URL', 'Credentials embedded in the URL are not allowed. Use the Authorization tab instead.');
    }
    const hostname = url.hostname.toLowerCase().replace(/\.$/, '').replace(/^\[|\]$/g, '');
    if (!hostname) throw new ProxyError('INVALID_URL', 'URL has no host');

    const port = url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80;
    if (BAD_PORTS.has(port)) {
      throw new ProxyError('BLOCKED_DESTINATION', `Port ${port} is blocked for security reasons`, { port });
    }

    if (METADATA_HOSTS.has(hostname)) {
      throw new ProxyError('BLOCKED_DESTINATION', 'Cloud metadata endpoints are blocked', { hostname });
    }
    if (!this.options.allowPrivateNetworks && LOCAL_SUFFIXES.some((s) => matchesHost(hostname, s))) {
      throw new ProxyError('BLOCKED_DESTINATION', `Host "${hostname}" refers to a local or internal network`, { hostname });
    }
    if (this.options.blockedHosts.some((rule) => matchesHost(hostname, rule))) {
      throw new ProxyError('BLOCKED_DESTINATION', `Host "${hostname}" is blocked by configuration`, { hostname });
    }
    if (this.options.allowedHosts.length > 0 && !this.options.allowedHosts.some((rule) => matchesHost(hostname, rule))) {
      throw new ProxyError('BLOCKED_DESTINATION', `Host "${hostname}" is not in the allowed hosts list`, { hostname });
    }

    if (isIP(hostname)) {
      const verdict = this.ipPolicy.evaluate(hostname);
      if (!verdict.allowed) {
        throw new ProxyError('BLOCKED_DESTINATION', `Address ${verdict.address} (${verdict.range}) is not allowed`, {
          address: verdict.address,
          range: verdict.range,
        });
      }
    }
  }
}
