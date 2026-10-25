import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { LookupAddress } from 'node:dns';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/app.setup.js';
import { APP_CONFIG, loadAppConfig, type AppConfig } from '../../src/config/app-config.js';
import { DNS_RESOLVER } from '../../src/proxy/proxy.service.js';
import { defaultResolver, type Resolver } from '../../src/proxy/security/safe-lookup.js';

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

/** Base config for tests: private networks allowed so local test servers are reachable. */
export function testConfig(overrides: DeepPartial<AppConfig> = {}): AppConfig {
  const base = loadAppConfig(() => undefined);
  return {
    ...base,
    ...overrides,
    rateLimit: { ...base.rateLimit, max: 10_000, ...overrides.rateLimit },
    proxy: { ...base.proxy, allowPrivateNetworks: true, ...overrides.proxy } as AppConfig['proxy'],
  } as AppConfig;
}

export async function createTestApp(config: AppConfig, resolver: Resolver = defaultResolver): Promise<NestExpressApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(APP_CONFIG)
    .useValue(config)
    .overrideProvider(DNS_RESOLVER)
    .useValue(resolver)
    .compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(app);
  await app.init();
  return app;
}

/** Resolver that maps hostnames to fixed addresses (simulates DNS answers). */
export function staticResolver(map: Record<string, string[]>): Resolver {
  return (hostname, _options, callback) => {
    const addresses = map[hostname];
    if (!addresses) return callback(Object.assign(new Error(`getaddrinfo ENOTFOUND ${hostname}`), { code: 'ENOTFOUND' }), []);
    callback(
      null,
      addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }) as LookupAddress),
    );
  };
}

export interface TestServer {
  url: string;
  port: number;
  requests: { method: string; url: string; headers: http.IncomingHttpHeaders; body: string }[];
  /** Responses whose connection was closed before the server finished them. */
  aborted: () => number;
  close: () => Promise<void>;
}

/** Starts a controlled HTTP server on 127.0.0.1 with a random port. */
export async function startServer(handler: (req: IncomingMessage, res: ServerResponse, body: string) => void): Promise<TestServer> {
  const requests: TestServer['requests'] = [];
  let aborted = 0;
  const server = http.createServer((req, res) => {
    res.on('close', () => {
      if (!res.writableFinished) aborted++;
    });
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      requests.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers, body });
      handler(req, res, body);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    port,
    requests,
    aborted: () => aborted,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
