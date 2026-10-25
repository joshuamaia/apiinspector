import type { NestExpressApplication } from '@nestjs/platform-express';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { gzipSync } from 'node:zlib';
import request from 'supertest';
import { createTestApp, staticResolver, startServer, testConfig, type TestServer } from './support/test-app.js';

const execute = (app: NestExpressApplication, body: object) =>
  request(app.getHttpServer()).post('/api/proxy/execute').set('Content-Type', 'application/json').send(body);

describe('Proxy (integration)', () => {
  let app: NestExpressApplication;
  let upstream: TestServer;
  let other: TestServer;

  beforeAll(async () => {
    upstream = await startServer((req, res, body) => {
      const url = new URL(req.url ?? '/', 'http://x');
      switch (url.pathname) {
        case '/json':
          res.writeHead(201, { 'Content-Type': 'application/json', 'X-Upstream': 'yes', Connection: 'keep-alive', 'Set-Cookie': ['sid=abc; HttpOnly', 'theme=dark'] });
          return res.end(JSON.stringify({ query: Object.fromEntries(url.searchParams), body }));
        case '/status':
          res.writeHead(Number(url.searchParams.get('code')), { 'Content-Type': 'text/plain' });
          return res.end('status body');
        case '/gzip':
          res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' });
          return res.end(gzipSync(JSON.stringify({ zipped: true })));
        case '/binary':
          res.writeHead(200, { 'Content-Type': 'image/png' });
          return res.end(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3]));
        case '/html':
          res.writeHead(200, { 'Content-Type': 'text/html' });
          return res.end('<html><body>hi</body></html>');
        case '/empty':
          res.writeHead(200);
          return res.end();
        case '/large':
          res.writeHead(200, { 'Content-Type': 'text/plain' });
          return res.end('x'.repeat(50_000));
        case '/redirect':
          res.writeHead(Number(url.searchParams.get('code') ?? 302), { Location: url.searchParams.get('to') ?? '/json' });
          return res.end();
        case '/loop':
          res.writeHead(302, { Location: '/loop' });
          return res.end();
        case '/hang':
          return; // never responds
        default:
          res.writeHead(404);
          return res.end();
      }
    });
    other = await startServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('other origin');
    });
    app = await createTestApp(testConfig({ proxy: { maxResponseBytes: 10_000, maxRedirects: 3 } }));
  });

  afterAll(async () => {
    await app.close();
    await upstream.close();
    await other.close();
  });

  it('forwards method, query, headers and body and returns the original response', async () => {
    const res = await execute(app, {
      method: 'POST',
      url: `${upstream.url}/json?page=2&q=a%20b`,
      headers: [
        { key: 'X-Custom', value: 'custom-value' },
        { key: 'X-Disabled', value: 'nope', enabled: false },
        { key: 'X-Forwarded-For', value: '1.2.3.4' },
      ],
      body: { mode: 'json', raw: '{"name":"Ada"}' },
    })
      .set('Cookie', 'bff_session=secret')
      .set('Authorization', 'Bearer bff-own-credential')
      .expect(200);

    const received = upstream.requests.at(-1)!;
    expect(received.method).toBe('POST');
    expect(received.url).toBe('/json?page=2&q=a%20b');
    expect(received.body).toBe('{"name":"Ada"}');
    expect(received.headers['x-custom']).toBe('custom-value');
    expect(received.headers['content-type']).toBe('application/json');
    expect(received.headers['host']).toBe(`127.0.0.1:${upstream.port}`);
    expect(received.headers['x-disabled']).toBeUndefined();
    expect(received.headers['x-forwarded-for']).toBeUndefined();
    // Credentials sent by the browser to the BFF itself must never leak upstream.
    expect(received.headers['cookie']).toBeUndefined();
    expect(received.headers['authorization']).toBeUndefined();

    expect(res.body.ok).toBe(true);
    expect(res.body.response.status).toBe(201);
    expect(JSON.parse(res.body.response.body)).toEqual({ query: { page: '2', q: 'a b' }, body: '{"name":"Ada"}' });
    const headerNames = res.body.response.headers.map(([k]: [string]) => k.toLowerCase());
    expect(headerNames).toContain('x-upstream');
    expect(headerNames).not.toContain('connection');
    expect(res.body.response.cookies.map((c: { name: string }) => c.name)).toEqual(['sid', 'theme']);
    expect(res.body.request.droppedHeaders).toEqual([{ key: 'X-Forwarded-For', reason: 'controlled by the proxy' }]);
    expect(res.body.timings.total).toBeGreaterThan(0);
  });

  it.each(['GET', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'])('supports %s', async (method) => {
    const res = await execute(app, { method, url: `${upstream.url}/json` }).expect(200);
    expect(res.body.response.status).toBe(201);
    expect(upstream.requests.at(-1)!.method).toBe(method);
  });

  it('supports HEAD without returning a body', async () => {
    const res = await execute(app, { method: 'HEAD', url: `${upstream.url}/json` }).expect(200);
    expect(res.body.response.body).toBe('');
  });

  it('passes HTTP errors through as successful proxy results', async () => {
    for (const code of [404, 500, 503]) {
      const res = await execute(app, { method: 'GET', url: `${upstream.url}/status?code=${code}` }).expect(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.response.status).toBe(code);
    }
  });

  it('applies authentication without echoing secrets', async () => {
    const res = await execute(app, {
      method: 'GET',
      url: `${upstream.url}/json`,
      auth: { type: 'apikey', key: 'api_key', value: 'super-secret', addTo: 'query' },
    }).expect(200);
    expect(upstream.requests.at(-1)!.url).toBe('/json?api_key=super-secret');
    expect(res.body.request.url).toContain('api_key=REDACTED');
    expect(JSON.stringify(res.body.request)).not.toContain('super-secret');

    const bearer = await execute(app, { method: 'GET', url: `${upstream.url}/json`, auth: { type: 'bearer', token: 'tok123' } }).expect(200);
    expect(upstream.requests.at(-1)!.headers['authorization']).toBe('Bearer tok123');
    expect(JSON.stringify(bearer.body.request)).not.toContain('tok123');
  });

  it('decompresses gzip responses', async () => {
    const res = await execute(app, { method: 'GET', url: `${upstream.url}/gzip` }).expect(200);
    expect(JSON.parse(res.body.response.body)).toEqual({ zipped: true });
    expect(res.body.response.encodedSize).toBeLessThan(res.body.response.size + 30);
  });

  it('returns binary bodies as base64, HTML as text and handles empty bodies', async () => {
    const bin = await execute(app, { method: 'GET', url: `${upstream.url}/binary` }).expect(200);
    expect(bin.body.response.bodyEncoding).toBe('base64');
    expect(Buffer.from(bin.body.response.body, 'base64')).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3]));
    const html = await execute(app, { method: 'GET', url: `${upstream.url}/html` }).expect(200);
    expect(html.body.response.body).toContain('<body>hi</body>');
    const empty = await execute(app, { method: 'GET', url: `${upstream.url}/empty` }).expect(200);
    expect(empty.body.response.size).toBe(0);
  });

  it('truncates responses over the configured limit', async () => {
    const res = await execute(app, { method: 'GET', url: `${upstream.url}/large` }).expect(200);
    expect(res.body.response.truncated).toBe(true);
    expect(res.body.response.body).toHaveLength(10_000);
    expect(res.body.response.warnings[0]).toMatch(/truncated/);
  });

  describe('redirects', () => {
    it('follows redirects and reports the final URL', async () => {
      const res = await execute(app, { method: 'GET', url: `${upstream.url}/redirect?to=/json` }).expect(200);
      expect(res.body.response.status).toBe(201);
      expect(res.body.response.finalUrl).toBe(`${upstream.url}/json`);
      expect(res.body.response.redirects).toEqual([{ status: 302, url: `${upstream.url}/json` }]);
    });

    it('does not follow when disabled', async () => {
      const res = await execute(app, { method: 'GET', url: `${upstream.url}/redirect?to=/json`, options: { followRedirects: false } }).expect(200);
      expect(res.body.response.status).toBe(302);
    });

    it('switches to GET on 303 and drops the body', async () => {
      await execute(app, { method: 'POST', url: `${upstream.url}/redirect?code=303&to=/json`, body: { mode: 'text', raw: 'data' } }).expect(200);
      const last = upstream.requests.at(-1)!;
      expect(last.method).toBe('GET');
      expect(last.body).toBe('');
    });

    it('strips credentials when redirecting to another origin', async () => {
      await execute(app, {
        method: 'GET',
        url: `${upstream.url}/redirect?to=${encodeURIComponent(`${other.url}/`)}`,
        auth: { type: 'bearer', token: 'secret' },
      }).expect(200);
      expect(other.requests.at(-1)!.headers['authorization']).toBeUndefined();
    });

    it('re-validates every redirect target', async () => {
      const res = await execute(app, {
        method: 'GET',
        url: `${upstream.url}/redirect?to=${encodeURIComponent('http://169.254.169.254/latest/meta-data/')}`,
      }).expect(403);
      expect(res.body.error.kind).toBe('BLOCKED_DESTINATION');
      const proto = await execute(app, { method: 'GET', url: `${upstream.url}/redirect?to=${encodeURIComponent('file:///etc/passwd')}` }).expect(400);
      expect(proto.body.error.kind).toBe('INVALID_URL');
    });

    it('stops redirect loops', async () => {
      const res = await execute(app, { method: 'GET', url: `${upstream.url}/loop` }).expect(502);
      expect(res.body.error.kind).toBe('TOO_MANY_REDIRECTS');
    });
  });

  describe('transport errors', () => {
    it('reports timeouts', async () => {
      const res = await execute(app, { method: 'GET', url: `${upstream.url}/hang`, options: { timeoutMs: 300 } }).expect(504);
      expect(res.body.error.kind).toBe('TIMEOUT');
    });

    it('reports refused connections', async () => {
      const closed = await startServer(() => undefined);
      const url = closed.url;
      await closed.close();
      const res = await execute(app, { method: 'GET', url }).expect(502);
      expect(res.body.error.kind).toBe('CONNECTION_REFUSED');
    });

    it('rejects invalid URLs and unsupported methods', async () => {
      expect((await execute(app, { method: 'GET', url: 'not a url' }).expect(400)).body.error.kind).toBe('INVALID_URL');
      expect((await execute(app, { method: 'TRACE', url: upstream.url }).expect(400)).body.error.kind).toBe('VALIDATION');
      expect((await execute(app, { method: 'GET', url: upstream.url, extra: true }).expect(400)).body.error.kind).toBe('VALIDATION');
    });
  });

  it('cancels the upstream request when the client disconnects', async () => {
    const slow = await startServer(() => undefined);
    const server = app.getHttpServer().listen(0, '127.0.0.1');
    await new Promise((r) => server.once('listening', r));
    const { port } = server.address() as AddressInfo;
    const client = http.request({ host: '127.0.0.1', port, path: '/api/proxy/execute', method: 'POST', headers: { 'Content-Type': 'application/json' } });
    client.on('error', () => undefined);
    client.end(JSON.stringify({ method: 'GET', url: `${slow.url}/` }));
    await waitFor(() => slow.requests.length === 1);
    expect(slow.aborted()).toBe(0);
    client.destroy();
    await waitFor(() => slow.aborted() === 1);
    server.close();
    await slow.close();
  });

  it('serves the built-in demo API without network access', async () => {
    const res = await execute(app, { method: 'GET', url: 'http://demo.api-inspector.invalid/users/1' }).expect(200);
    expect(res.body.virtual).toBe(true);
    expect(JSON.parse(res.body.response.body).username).toBe('ada');
  });

  it('exposes limits and health', async () => {
    const limits = await request(app.getHttpServer()).get('/api/proxy/limits').expect(200);
    expect(limits.body.maxRedirects).toBe(3);
    await request(app.getHttpServer()).get('/api/health').expect(200);
  });
});

async function waitFor(condition: () => boolean, timeoutMs = 3000): Promise<void> {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > timeoutMs) throw new Error('Condition not met in time');
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe('Proxy security (integration)', () => {
  let upstream: TestServer;

  beforeAll(async () => {
    upstream = await startServer((_req, res) => {
      setTimeout(() => {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('ok');
      }, 150);
    });
  });
  afterAll(() => upstream.close());

  it('blocks loopback and private destinations by default', async () => {
    const app = await createTestApp(testConfig({ proxy: { allowPrivateNetworks: false } }));
    for (const url of [upstream.url, 'http://localhost:8080', 'http://[::1]:8080', 'http://10.0.0.1', 'http://169.254.169.254']) {
      const res = await execute(app, { method: 'GET', url }).expect(403);
      expect(res.body.error.kind).toBe('BLOCKED_DESTINATION');
    }
    expect(upstream.requests).toHaveLength(0);
    await app.close();
  });

  it('blocks hostnames that resolve to internal addresses (DNS rebinding)', async () => {
    const resolver = staticResolver({ 'rebind.test': ['127.0.0.1'], 'mixed.test': ['93.184.216.34', '10.0.0.8'] });
    const app = await createTestApp(testConfig({ proxy: { allowPrivateNetworks: false } }), resolver);
    for (const host of ['rebind.test', 'mixed.test']) {
      const res = await execute(app, { method: 'GET', url: `http://${host}:${upstream.port}/` }).expect(403);
      expect(res.body.error.kind).toBe('BLOCKED_DESTINATION');
    }
    const dns = await execute(app, { method: 'GET', url: 'http://unknown.test/' }).expect(502);
    expect(dns.body.error.kind).toBe('DNS_FAILURE');
    await app.close();
  });

  it('connects to the address validated during lookup', async () => {
    const resolver = staticResolver({ 'api.test': ['127.0.0.1'] });
    const app = await createTestApp(testConfig(), resolver);
    const res = await execute(app, { method: 'GET', url: `http://api.test:${upstream.port}/` }).expect(200);
    expect(res.body.response.remoteAddress).toBe('127.0.0.1');
    expect(upstream.requests.at(-1)!.headers['host']).toBe(`api.test:${upstream.port}`);
    await app.close();
  });

  it('enforces rate limiting', async () => {
    const app = await createTestApp(testConfig({ rateLimit: { max: 2, windowMs: 60_000 } }));
    await execute(app, { method: 'GET', url: 'http://demo.api-inspector.invalid/' }).expect(200);
    await execute(app, { method: 'GET', url: 'http://demo.api-inspector.invalid/' }).expect(200);
    const res = await execute(app, { method: 'GET', url: 'http://demo.api-inspector.invalid/' }).expect(429);
    expect(res.body.error.kind).toBe('RATE_LIMITED');
    await app.close();
  });

  it('enforces the per-client concurrency limit', async () => {
    const app = await createTestApp(testConfig({ proxy: { maxConcurrencyPerClient: 1 } }));
    const results = await Promise.all([
      execute(app, { method: 'GET', url: upstream.url }),
      execute(app, { method: 'GET', url: upstream.url }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 429]);
    expect(results.find((r) => r.status === 429)!.body.error.kind).toBe('CONCURRENCY_LIMIT');
    await app.close();
  });

  it('requires the access token when configured', async () => {
    const app = await createTestApp(testConfig({ accessToken: 's3cret' }));
    const body = { method: 'GET', url: 'http://demo.api-inspector.invalid/' };
    expect((await execute(app, body).expect(401)).body.error.kind).toBe('UNAUTHORIZED');
    await execute(app, body).set('x-api-inspector-token', 'wrong').expect(401);
    await execute(app, body).set('x-api-inspector-token', 's3cret').expect(200);
    await app.close();
  });

  it('rejects browser requests from origins that are not allowed', async () => {
    const app = await createTestApp(testConfig({ allowedOrigins: ['http://localhost:8080'] }));
    const body = { method: 'GET', url: 'http://demo.api-inspector.invalid/' };
    expect((await execute(app, body).set('Origin', 'https://evil.example').expect(403)).body.error.kind).toBe('FORBIDDEN_ORIGIN');
    await execute(app, body).set('Origin', 'http://localhost:8080').expect(200);
    await app.close();
  });

  it('rejects oversized payloads', async () => {
    const app = await createTestApp(testConfig({ proxy: { maxRequestBodyBytes: 2048 } }));
    const res = await execute(app, { method: 'POST', url: upstream.url, body: { mode: 'text', raw: 'x'.repeat(5000) } }).expect(413);
    expect(res.body.error.kind).toBe('PAYLOAD_TOO_LARGE');
    await app.close();
  });
});
