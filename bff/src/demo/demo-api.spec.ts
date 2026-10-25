import { DEMO_BASE_URL, handleDemoRequest, issueToken } from './demo-api.js';

const call = async (method: string, path: string, opts: { body?: unknown; headers?: Record<string, string> } = {}) => {
  const res = await handleDemoRequest({
    method,
    url: new URL(path, DEMO_BASE_URL),
    headers: opts.headers ?? {},
    body: opts.body === undefined ? null : Buffer.from(JSON.stringify(opts.body)),
  });
  const text = res.body.toString('utf8');
  return { ...res, json: text ? JSON.parse(text) : null };
};

describe('demo API', () => {
  it('logs in and issues a token usable on protected routes', async () => {
    const login = await call('POST', '/auth/login', { body: { username: 'ada', password: 'demo123' } });
    expect(login.status).toBe(200);
    const token = login.json.accessToken;
    const me = await call('GET', '/auth/me', { headers: { authorization: `Bearer ${token}` } });
    expect(me.json.username).toBe('ada');
  });

  it('rejects wrong credentials and forged tokens', async () => {
    expect((await call('POST', '/auth/login', { body: { username: 'ada', password: 'x' } })).status).toBe(401);
    const forged = issueToken(1).replace(/.$/, 'x');
    expect((await call('GET', '/auth/me', { headers: { authorization: `Bearer ${forged}` } })).status).toBe(401);
  });

  it('supports CRUD-like user routes', async () => {
    expect((await call('GET', '/users')).json).toHaveLength(5);
    expect((await call('GET', '/users?role=editor')).json).toHaveLength(2);
    expect((await call('GET', '/users/2')).json.name).toBe('Alan Turing');
    expect((await call('GET', '/users/99')).status).toBe(404);
    expect((await call('POST', '/users', { body: { name: 'New' } })).status).toBe(201);
    expect((await call('POST', '/users', { body: {} })).status).toBe(422);
    expect((await call('PUT', '/users/1', { body: { name: 'X' } })).json).toMatchObject({ id: 1, name: 'X' });
    expect((await call('DELETE', '/users/1')).status).toBe(204);
  });

  it('serves drifting product contracts', async () => {
    const v1 = (await call('GET', '/products/v1/1')).json;
    const v2 = (await call('GET', '/products/v2/1')).json;
    expect(typeof v1.price).toBe('number');
    expect(typeof v2.price).toBe('object');
    expect(v2.dimensions.depth).toBeUndefined();
  });

  it('returns arbitrary statuses and alternative formats', async () => {
    expect((await call('GET', '/status/503')).status).toBe(503);
    const html = await handleDemoRequest({ method: 'GET', url: new URL('/formats/html', DEMO_BASE_URL), headers: {}, body: null });
    expect(html.headers[0][1]).toContain('text/html');
  });
});
