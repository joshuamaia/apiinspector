import type { Collection, Folder, SavedRequest } from '../models/collection.model';
import type { ContractBaseline, ContractField } from '../models/drift.model';
import type { Flow, FlowExtraction, FlowNode } from '../models/flow.model';
import type { HttpMethod, RequestDefinition } from '../models/request.model';
import { inferContract } from '../utils/drift';
import { createRequest, emptyAuth, kv } from '../utils/request';
import { syncParamsFromUrl } from '../utils/url';

/** Reserved host served in-process by the BFF (see bff/src/demo/demo-api.ts). */
export const DEMO_API = 'http://demo.api-inspector.invalid';
const JSONPLACEHOLDER = 'https://jsonplaceholder.typicode.com';

const T0 = Date.UTC(2025, 0, 1);

function req(method: HttpMethod, url: string, extra: Partial<RequestDefinition> = {}): RequestDefinition {
  return createRequest({ method, url, params: syncParamsFromUrl(url, []), ...extra });
}

function json(value: unknown): RequestDefinition['body'] {
  return { mode: 'json', raw: JSON.stringify(value, null, 2), fields: [] };
}

function saved(id: string, collectionId: string, folderId: string | null, name: string, description: string, def: RequestDefinition, i: number): SavedRequest {
  return { ...def, id, name, description, collectionId, folderId, favorite: false, createdAt: T0 + i, updatedAt: T0 + i, secrets: null };
}

export function demoCollections(): { collections: Collection[]; folders: Folder[]; requests: SavedRequest[] } {
  const jp = 'demo-col-jsonplaceholder';
  const local = 'demo-col-local';
  const collections: Collection[] = [
    { id: jp, name: 'JSONPlaceholder (public)', description: 'CRUD examples using jsonplaceholder.typicode.com. Writes are faked by the API and not persisted.', createdAt: T0, demo: true },
    { id: local, name: 'Built-in Demo API (offline)', description: 'In-process demo API served by the BFF — works without internet.', createdAt: T0 + 1, demo: true },
  ];
  const folders: Folder[] = [
    { id: 'demo-fld-users', collectionId: jp, parentId: null, name: 'Users', createdAt: T0 },
    { id: 'demo-fld-posts', collectionId: jp, parentId: null, name: 'Posts', createdAt: T0 },
    { id: 'demo-fld-auth', collectionId: local, parentId: null, name: 'Auth & users', createdAt: T0 },
    { id: 'demo-fld-formats', collectionId: local, parentId: null, name: 'Formats & errors', createdAt: T0 },
    { id: 'demo-fld-contracts', collectionId: local, parentId: null, name: 'Contracts', createdAt: T0 },
  ];
  let i = 0;
  const requests: SavedRequest[] = [
    saved('demo-req-jp-users', jp, 'demo-fld-users', 'List users', 'GET — returns 10 users', req('GET', `${JSONPLACEHOLDER}/users`), i++),
    saved('demo-req-jp-user', jp, 'demo-fld-users', 'Get user by id', 'GET — single resource by identifier', req('GET', `${JSONPLACEHOLDER}/users/1`), i++),
    saved(
      'demo-req-jp-create',
      jp,
      'demo-fld-posts',
      'Create post',
      'POST — returns 201 with id 101 (not persisted)',
      req('POST', `${JSONPLACEHOLDER}/posts`, { headers: [kv('Content-Type', 'application/json; charset=UTF-8')], body: json({ title: 'API Inspector', body: 'Created from the demo collection', userId: 1 }) }),
      i++,
    ),
    saved(
      'demo-req-jp-update',
      jp,
      'demo-fld-posts',
      'Replace post',
      'PUT — full update of post 1 (simulated)',
      req('PUT', `${JSONPLACEHOLDER}/posts/1`, { headers: [kv('Content-Type', 'application/json; charset=UTF-8')], body: json({ id: 1, title: 'Updated title', body: 'Updated body', userId: 1 }) }),
      i++,
    ),
    saved(
      'demo-req-jp-patch',
      jp,
      'demo-fld-posts',
      'Patch post title',
      'PATCH — partial update (simulated)',
      req('PATCH', `${JSONPLACEHOLDER}/posts/1`, { headers: [kv('Content-Type', 'application/json; charset=UTF-8')], body: json({ title: 'Only the title changes' }) }),
      i++,
    ),
    saved('demo-req-jp-delete', jp, 'demo-fld-posts', 'Delete post', 'DELETE — returns 200 with an empty object (simulated)', req('DELETE', `${JSONPLACEHOLDER}/posts/1`), i++),
    saved('demo-req-jp-comments', jp, 'demo-fld-posts', 'Comments of a post', 'GET with query parameters', req('GET', `${JSONPLACEHOLDER}/comments?postId=1`), i++),

    saved('demo-req-login', local, 'demo-fld-auth', 'Login', 'Returns a Bearer token (user: ada / demo123)', req('POST', `${DEMO_API}/auth/login`, { body: json({ username: 'ada', password: 'demo123' }) }), i++),
    saved('demo-req-users', local, 'demo-fld-auth', 'List editors', 'Query parameter filter', req('GET', `${DEMO_API}/users?role=editor&active=true`), i++),
    saved(
      'demo-req-me',
      local,
      'demo-fld-auth',
      'Who am I (needs token)',
      'Paste the token from "Login" in the Auth tab',
      req('GET', `${DEMO_API}/auth/me`, { auth: { ...emptyAuth(), type: 'bearer', token: '' } }),
      i++,
    ),
    saved('demo-req-echo', local, 'demo-fld-auth', 'Echo request', 'Shows exactly what the proxy sent', req('POST', `${DEMO_API}/echo?source=inspector`, { headers: [kv('X-Correlation-Id', 'demo-123')], body: json({ hello: 'world' }) }), i++),
    saved('demo-req-html', local, 'demo-fld-formats', 'HTML response', 'Non-JSON content with sandboxed preview', req('GET', `${DEMO_API}/formats/html`), i++),
    saved('demo-req-xml', local, 'demo-fld-formats', 'XML response', '', req('GET', `${DEMO_API}/formats/xml`), i++),
    saved('demo-req-binary', local, 'demo-fld-formats', 'Binary response', 'Shown as hex, downloadable', req('GET', `${DEMO_API}/formats/binary`), i++),
    saved('demo-req-gzip', local, 'demo-fld-formats', 'Gzip response', 'Decompressed by the proxy', req('GET', `${DEMO_API}/formats/gzip`), i++),
    saved('demo-req-503', local, 'demo-fld-formats', 'Server error (503)', 'HTTP errors are not transport errors', req('GET', `${DEMO_API}/status/503`), i++),
    saved('demo-req-delay', local, 'demo-fld-formats', 'Slow response (3 s)', 'Try the Cancel button', req('GET', `${DEMO_API}/delay/3000`), i++),
    saved('demo-req-blocked', local, 'demo-fld-formats', 'Blocked destination (SSRF)', 'Cloud metadata endpoints are always blocked', req('GET', 'http://169.254.169.254/latest/meta-data/'), i++),
    saved('demo-req-product-v1', local, 'demo-fld-contracts', 'Product v1', 'Reference contract', req('GET', `${DEMO_API}/products/v1/1`), i++),
    saved('demo-req-product-v2', local, 'demo-fld-contracts', 'Product v2', 'Drifted contract', req('GET', `${DEMO_API}/products/v2/1`), i++),
  ];
  return { collections, folders, requests };
}

function extraction(name: string, expression: string, expectedType: FlowExtraction['expectedType'], syntax: FlowExtraction['syntax'] = 'jsonpath'): FlowExtraction {
  return { id: `x-${name}`, name, source: 'body', syntax, expression, expectedType, required: true };
}

function node(id: string, name: string, x: number, y: number, request: RequestDefinition, extra: Partial<FlowNode> = {}): FlowNode {
  return { id, name, x, y, request, extractions: [], expectedStatus: '2xx', continueOnError: false, ...extra };
}

/** POST /auth/login → GET /users → GET /users/{id} → PUT /users/{id} (+ orders branch). */
export function demoFlow(): Flow {
  const bearer = { ...emptyAuth(), type: 'bearer' as const, token: '{{token}}' };
  return {
    id: 'demo-flow-login',
    name: 'Login → users → update (demo)',
    description: 'Logs in, reuses the token as Bearer and chains user ids between steps. Uses the offline demo API.',
    variables: [kv('baseUrl', DEMO_API)],
    stopOnError: true,
    createdAt: T0,
    updatedAt: T0,
    demo: true,
    nodes: [
      node('n-login', 'Login', 300, 40, req('POST', '{{baseUrl}}/auth/login', { body: json({ username: 'ada', password: 'demo123' }) }), {
        expectedStatus: '200',
        extractions: [extraction('token', '$.accessToken', 'string'), extraction('me', '/user/id', 'number', 'pointer')],
      }),
      node('n-users', 'List users', 300, 175, req('GET', '{{baseUrl}}/users', { auth: bearer }), {
        extractions: [extraction('userId', '$[1].id', 'number'), extraction('editors', "$[?(@.role == 'editor')].username", 'array')],
      }),
      node('n-user', 'Get user', 300, 310, req('GET', '{{baseUrl}}/users/{{userId}}', { auth: bearer }), {
        extractions: [extraction('userName', '$.name', 'string')],
      }),
      node(
        'n-update',
        'Update user',
        110,
        460,
        req('PUT', '{{baseUrl}}/users/{{userId}}', { auth: bearer, body: { mode: 'json', raw: '{\n  "name": "{{userName}} (updated)",\n  "role": "admin"\n}', fields: [] } }),
        { expectedStatus: '200' },
      ),
      node('n-orders', 'User orders', 490, 460, req('GET', '{{baseUrl}}/users/{{me}}/orders', { auth: bearer }), {
        extractions: [extraction('firstOrder', '$[0].id', 'number')],
      }),
    ],
    edges: [
      { id: 'e1', from: 'n-login', to: 'n-users' },
      { id: 'e2', from: 'n-users', to: 'n-user' },
      { id: 'e3', from: 'n-user', to: 'n-update' },
      { id: 'e4', from: 'n-user', to: 'n-orders' },
    ],
  };
}

/** Local JSON responses for the Smart API Diff demo (no network needed). */
export const DIFF_DEMO = {
  left: {
    label: 'Release 2025.08.17',
    status: 200,
    durationMs: 182,
    headers: [
      ['Content-Type', 'application/json; charset=utf-8'],
      ['Cache-Control', 'max-age=60'],
      ['X-RateLimit-Limit', '120'],
      ['ETag', 'W/"a1b2c3"'],
    ] as [string, string][],
    body: {
      diagnostics: null,
      extras: { apiKey: 'DEMO-ABC', ignoreKeys: ['temp', 'debug'], ignorePaths: ['meta.*', 'features[].temp'] },
      features: [
        { key: 'exportHTML', enabled: true },
        { key: 'exportRFC6902', enabled: false },
        { key: 'copyMarkdown', enabled: true },
      ],
      limits: { rpm: 120, burst: 20 },
      meta: { generatedAt: '2025-08-17T09:12:44Z', requestId: '3f2b8c1e-1d2a-4b3c-9d8e-7f6a5b4c3d2e' },
      status: 'ok',
      version: 3,
    },
  },
  right: {
    label: 'Release 2025.08.18',
    status: 200,
    durationMs: 247,
    headers: [
      ['Content-Type', 'application/json; charset=utf-8'],
      ['Cache-Control', 'no-cache'],
      ['X-RateLimit-Limit', '240'],
      ['X-Deprecated', 'extras.apiKey'],
      ['ETag', 'W/"d4e5f6"'],
    ] as [string, string][],
    body: {
      diagnostics: { issues: 2, lastCheck: '2025-08-18T07:10:00Z' },
      extras: { APIKey: 'DEMO-ABC', ignoreKeys: ['debug', 'temp', 'cache'], ignorePaths: ['meta.*', 'features[].temp', 'logs.*'] },
      features: [
        { key: 'exportHTML', enabled: true },
        { key: 'exportRFC6902', enabled: true },
        { key: 'copyUnified', enabled: true },
        { key: 'exportPDF', enabled: true },
      ],
      limits: { rpm: 240 },
      meta: { generatedAt: '2025-08-18T07:10:02Z', requestId: '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d' },
      status: 'ok',
      version: '3.1',
    },
  },
};

/** Reference response of `GET /products/v1/1` (local copy, so the demo works offline). */
export const PRODUCT_V1_SAMPLE = {
  id: 1,
  sku: 'SKU-1001',
  name: 'Mechanical Keyboard',
  price: 129.9,
  currency: 'USD',
  inStock: true,
  tags: ['peripherals', 'keyboards'],
  dimensions: { width: 44.5, height: 3.8, depth: 13.2 },
  supplier: { id: 7, name: 'KeyWorks Ltd.', country: 'DE' },
  updatedAt: '2025-08-18T07:10:00.000Z',
};

/** Response of `GET /products/v2/1` (local copy). */
export const PRODUCT_V2_SAMPLE = {
  id: '1',
  sku: 'SKU-1001',
  name: 'Mechanical Keyboard',
  price: { amount: 129.9, currency: 'USD' },
  inStock: null,
  tags: ['peripherals', 'keyboards'],
  dimensions: { width: 44.5, height: 3.8 },
  supplier: { id: 7, name: 'KeyWorks Ltd.' },
  rating: 4.7,
  updatedAt: '2025-08-19T10:00:00.000Z',
};

export function demoBaseline(): ContractBaseline {
  const requirements: Record<string, ContractField['requirement']> = {
    '$.id': 'required',
    '$.sku': 'required',
    '$.name': 'required',
    '$.price': 'required',
    '$.currency': 'optional',
    '$.inStock': 'required',
    '$.tags': 'optional',
    '$.tags[]': 'optional',
    '$.dimensions': 'required',
    '$.dimensions.width': 'required',
    '$.dimensions.height': 'required',
    '$.dimensions.depth': 'required',
    '$.supplier': 'optional',
    '$.supplier.id': 'required',
    '$.supplier.name': 'optional',
    '$.updatedAt': 'optional',
    // $.supplier.country intentionally left unspecified to show "insufficient information".
  };
  return {
    id: 'demo-baseline-product',
    name: 'Product contract (v1)',
    description: 'Reference captured from GET /products/v1/1. Run the linked "Product v2" request to see the drift.',
    requestId: 'demo-req-product-v2',
    sample: JSON.stringify(PRODUCT_V1_SAMPLE, null, 2),
    fields: inferContract(PRODUCT_V1_SAMPLE).map((f) => ({ ...f, requirement: requirements[f.path] ?? f.requirement })),
    strictAdditions: false,
    createdAt: T0,
    updatedAt: T0,
    demo: true,
  };
}
