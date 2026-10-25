import { createHmac, randomUUID } from 'node:crypto';
import { gzipSync } from 'node:zlib';

/**
 * Built-in demo API served in-process for the reserved host below (`.invalid`
 * is an IANA reserved TLD that never resolves). No socket is opened, so the
 * demos work offline and this does not weaken the SSRF protections.
 * Like JSONPlaceholder, write operations are simulated and not persisted.
 */
export const DEMO_HOST = 'demo.api-inspector.invalid';
export const DEMO_BASE_URL = `http://${DEMO_HOST}`;

export interface DemoRequest {
  method: string;
  url: URL;
  headers: Record<string, string>;
  body: Buffer | null;
}

export interface DemoResponse {
  status: number;
  headers: [string, string][];
  body: Buffer;
}

const SECRET = 'api-inspector-demo-secret';

const USERS = [
  { id: 1, username: 'ada', name: 'Ada Lovelace', email: 'ada@example.com', role: 'admin', active: true },
  { id: 2, username: 'alan', name: 'Alan Turing', email: 'alan@example.com', role: 'editor', active: true },
  { id: 3, username: 'grace', name: 'Grace Hopper', email: 'grace@example.com', role: 'viewer', active: false },
  { id: 4, username: 'linus', name: 'Linus Torvalds', email: 'linus@example.com', role: 'editor', active: true },
  { id: 5, username: 'margaret', name: 'Margaret Hamilton', email: 'margaret@example.com', role: 'viewer', active: true },
];

const ORDERS = [
  { id: 101, userId: 1, total: 249.9, currency: 'USD', status: 'paid', items: 3 },
  { id: 102, userId: 1, total: 19.0, currency: 'USD', status: 'pending', items: 1 },
  { id: 103, userId: 2, total: 1200.5, currency: 'EUR', status: 'shipped', items: 7 },
  { id: 104, userId: 4, total: 75.25, currency: 'USD', status: 'paid', items: 2 },
];

function json(status: number, data: unknown, extra: [string, string][] = []): DemoResponse {
  return {
    status,
    headers: [['Content-Type', 'application/json; charset=utf-8'], ['Cache-Control', 'no-store'], ...extra],
    body: Buffer.from(JSON.stringify(data, null, 2)),
  };
}

function text(status: number, contentType: string, body: string): DemoResponse {
  return { status, headers: [['Content-Type', contentType]], body: Buffer.from(body) };
}

function sign(payload: string): string {
  return createHmac('sha256', SECRET).update(payload).digest('base64url');
}

export function issueToken(userId: number, now = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ sub: userId, iat: Math.floor(now / 1000), exp: Math.floor(now / 1000) + 3600 })).toString('base64url');
  return `demo.${payload}.${sign(payload)}`;
}

function verifyToken(header: string | undefined): { sub: number } | null {
  const match = /^Bearer\s+demo\.([\w-]+)\.([\w-]+)$/.exec(header ?? '');
  if (!match || sign(match[1]) !== match[2]) return null;
  try {
    const claims = JSON.parse(Buffer.from(match[1], 'base64url').toString('utf8')) as { sub: number; exp: number };
    if (claims.exp * 1000 < Date.now()) return null;
    return { sub: claims.sub };
  } catch {
    return null;
  }
}

function parseJson(body: Buffer | null): Record<string, unknown> | null {
  if (!body?.length) return null;
  try {
    const parsed = JSON.parse(body.toString('utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

const unauthorized = () =>
  json(401, { error: 'unauthorized', message: 'Missing or invalid Bearer token' }, [['WWW-Authenticate', 'Bearer realm="demo"']]);

function product(version: 1 | 2, id: number): unknown {
  if (version === 1) {
    return {
      id,
      sku: `SKU-${1000 + id}`,
      name: 'Mechanical Keyboard',
      price: 129.9,
      currency: 'USD',
      inStock: true,
      tags: ['peripherals', 'keyboards'],
      dimensions: { width: 44.5, height: 3.8, depth: 13.2 },
      supplier: { id: 7, name: 'KeyWorks Ltd.', country: 'DE' },
      updatedAt: new Date().toISOString(),
    };
  }
  // v2 intentionally drifts from v1 to demonstrate the Contract Drift Detector.
  return {
    id: String(id),
    sku: `SKU-${1000 + id}`,
    name: 'Mechanical Keyboard',
    price: { amount: 129.9, currency: 'USD' },
    inStock: null,
    tags: ['peripherals', 'keyboards'],
    dimensions: { width: 44.5, height: 3.8 },
    supplier: { id: 7, name: 'KeyWorks Ltd.' },
    rating: 4.7,
    updatedAt: new Date().toISOString(),
  };
}

function route(req: DemoRequest): DemoResponse {
  const path = req.url.pathname.replace(/\/+$/, '') || '/';
  const method = req.method;
  const segments = path.split('/').filter(Boolean);
  const auth = () => verifyToken(req.headers['authorization']);

  if (path === '/' && method === 'GET') {
    return json(200, {
      name: 'API Inspector Demo API',
      description: 'In-process demo API. Writes are simulated and not persisted.',
      credentials: { username: 'ada', password: 'demo123' },
      endpoints: [
        'POST /auth/login',
        'GET /auth/me',
        'GET /users?role=&active=',
        'GET /users/:id',
        'POST /users',
        'PUT|PATCH /users/:id',
        'DELETE /users/:id',
        'GET /users/:id/orders (Bearer)',
        'GET /products/v1/:id',
        'GET /products/v2/:id',
        'GET /status/:code',
        'GET /delay/:ms',
        'GET /formats/{html|xml|text|binary|gzip|empty}',
        'ANY /echo',
      ],
    });
  }

  if (path === '/auth/login') {
    if (method !== 'POST') return json(405, { error: 'method_not_allowed' }, [['Allow', 'POST']]);
    const body = parseJson(req.body);
    const user = USERS.find((u) => u.username === body?.['username']);
    if (!user || body?.['password'] !== 'demo123') {
      return json(401, { error: 'invalid_credentials', message: 'Use username "ada" (or any demo user) with password "demo123"' });
    }
    return json(
      200,
      { accessToken: issueToken(user.id), tokenType: 'Bearer', expiresIn: 3600, user: { id: user.id, username: user.username } },
      [['Set-Cookie', `demo_session=${randomUUID()}; Path=/; HttpOnly; Secure; SameSite=Lax`]],
    );
  }

  if (path === '/auth/me' && method === 'GET') {
    const claims = auth();
    if (!claims) return unauthorized();
    return json(200, USERS.find((u) => u.id === claims.sub) ?? null);
  }

  if (segments[0] === 'users') {
    if (segments.length === 1) {
      if (method === 'GET') {
        const role = req.url.searchParams.get('role');
        const active = req.url.searchParams.get('active');
        const result = USERS.filter((u) => (!role || u.role === role) && (active === null || String(u.active) === active));
        return json(200, result, [['X-Total-Count', String(result.length)]]);
      }
      if (method === 'POST') {
        const body = parseJson(req.body);
        if (!body?.['name']) return json(422, { error: 'validation_failed', fields: { name: 'is required' } });
        return json(201, { id: USERS.length + 1, active: true, role: 'viewer', ...body, createdAt: new Date().toISOString() }, [
          ['Location', `${DEMO_BASE_URL}/users/${USERS.length + 1}`],
        ]);
      }
      return json(405, { error: 'method_not_allowed' }, [['Allow', 'GET, POST']]);
    }
    const id = Number(segments[1]);
    const user = USERS.find((u) => u.id === id);
    if (segments.length === 3 && segments[2] === 'orders' && method === 'GET') {
      if (!auth()) return unauthorized();
      if (!user) return json(404, { error: 'not_found', message: `User ${segments[1]} not found` });
      return json(200, ORDERS.filter((o) => o.userId === id));
    }
    if (segments.length === 2) {
      if (!user) return json(404, { error: 'not_found', message: `User ${segments[1]} not found` });
      if (method === 'GET') return json(200, user, [['ETag', `"user-${id}-v1"`]]);
      if (method === 'PUT' || method === 'PATCH') {
        const body = parseJson(req.body);
        if (!body) return json(400, { error: 'invalid_json', message: 'Body must be a JSON object' });
        const merged = method === 'PUT' ? { id, ...body } : { ...user, ...body, id };
        return json(200, { ...merged, updatedAt: new Date().toISOString() });
      }
      if (method === 'DELETE') return { status: 204, headers: [], body: Buffer.alloc(0) };
    }
  }

  if (segments[0] === 'products' && segments.length === 3 && method === 'GET') {
    const version = segments[1] === 'v1' ? 1 : segments[1] === 'v2' ? 2 : null;
    const id = Number(segments[2]);
    if (version && Number.isInteger(id) && id > 0) return json(200, product(version, id));
  }

  if (segments[0] === 'status' && segments.length === 2) {
    const code = Number(segments[1]);
    if (Number.isInteger(code) && code >= 200 && code <= 599) {
      return code === 204 || code === 304
        ? { status: code, headers: [], body: Buffer.alloc(0) }
        : json(code, { status: code, message: `Demo response with status ${code}` });
    }
  }

  if (segments[0] === 'formats' && segments.length === 2 && method === 'GET') {
    switch (segments[1]) {
      case 'html':
        return text(200, 'text/html; charset=utf-8', '<!doctype html><html><head><title>Demo</title></head><body><h1>Hello from the demo API</h1><p>This is an HTML response.</p></body></html>');
      case 'xml':
        return text(200, 'application/xml; charset=utf-8', '<?xml version="1.0"?>\n<users>\n  <user id="1"><name>Ada Lovelace</name></user>\n  <user id="2"><name>Alan Turing</name></user>\n</users>');
      case 'text':
        return text(200, 'text/plain; charset=utf-8', 'Plain text response.\nLine 2.');
      case 'binary': {
        const bytes = Buffer.alloc(256);
        for (let i = 0; i < bytes.length; i++) bytes[i] = i;
        return { status: 200, headers: [['Content-Type', 'application/octet-stream'], ['Content-Disposition', 'attachment; filename="bytes.bin"']], body: bytes };
      }
      case 'gzip':
        return {
          status: 200,
          headers: [['Content-Type', 'application/json'], ['Content-Encoding', 'gzip']],
          body: gzipSync(Buffer.from(JSON.stringify({ compressed: true, users: USERS }))),
        };
      case 'empty':
        return { status: 200, headers: [['Content-Length', '0']], body: Buffer.alloc(0) };
    }
  }

  if (path === '/echo') {
    return json(200, {
      method,
      path: req.url.pathname,
      query: Object.fromEntries(req.url.searchParams),
      headers: req.headers,
      body: req.body?.toString('utf8') ?? null,
    });
  }

  return json(404, { error: 'not_found', message: `No demo route for ${method} ${path}` });
}

/** Handles a request addressed to the demo host, honoring `/delay/:ms`. */
export async function handleDemoRequest(req: DemoRequest, signal?: AbortSignal): Promise<DemoResponse> {
  const delayMatch = /^\/delay\/(\d+)\/?$/.exec(req.url.pathname);
  if (delayMatch) {
    const ms = Math.min(Number(delayMatch[1]), 30_000);
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(resolve, ms);
      signal?.addEventListener('abort', () => {
        clearTimeout(t);
        reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      });
    });
    return json(200, { delayedMs: ms });
  }
  return route(req);
}
