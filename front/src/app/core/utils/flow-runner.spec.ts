import type { Flow, FlowExtraction, FlowNode, FlowRun } from '../models/flow.model';
import { extractValue, matchesExpectedStatus } from './extract';
import { executionOrder, FlowCycleError, runFlow, type StepExecutor } from './flow-runner';
import { createRequest } from './request';
import { interpolate } from './interpolate';

const extraction = (partial: Partial<FlowExtraction>): FlowExtraction => ({
  id: 'e',
  name: 'v',
  source: 'body',
  syntax: 'jsonpath',
  expression: '$.token',
  expectedType: 'any',
  required: true,
  ...partial,
});

describe('extractValue', () => {
  const source = { status: 201, headers: [['X-Rate', '10'] as [string, string]], body: '{"token":"abc","user":{"id":7},"list":[]}' };

  it('extracts values with JSONPath, JSON Pointer, headers and status', () => {
    expect(extractValue(source, extraction({}))).toEqual({ ok: true, value: 'abc' });
    expect(extractValue(source, extraction({ syntax: 'pointer', expression: '/user/id' }))).toEqual({ ok: true, value: 7 });
    expect(extractValue(source, extraction({ source: 'header', expression: 'x-rate' }))).toEqual({ ok: true, value: '10' });
    expect(extractValue(source, extraction({ source: 'status' }))).toEqual({ ok: true, value: 201 });
  });

  it('validates existence and type', () => {
    expect(extractValue(source, extraction({ expression: '$.nope' })).error).toMatch(/not found/);
    expect(extractValue(source, extraction({ expression: '$.nope', required: false }))).toEqual({ ok: true, value: undefined });
    expect(extractValue(source, extraction({ expression: '$.user.id', expectedType: 'string' })).error).toBe('Expected string but got number');
    expect(extractValue(source, extraction({ expression: '$.list[*]' })).error).toMatch(/not found/);
    expect(extractValue({ ...source, body: '<html>' }, extraction({})).error).toMatch(/not valid JSON/);
    expect(extractValue(source, extraction({ expression: 'token' })).error).toMatch(/must start/);
  });
});

describe('matchesExpectedStatus', () => {
  it.each([
    [200, '', true],
    [302, '', true],
    [404, '', false],
    [201, '2xx', true],
    [301, '2xx', false],
    [201, '200,201', true],
    [250, '200-299', true],
    [503, '!5xx', false],
    [404, '404', true],
  ])('%i vs "%s" → %s', (status, expr, expected) => {
    expect(matchesExpectedStatus(status, expr)).toBe(expected);
  });
});

function node(id: string, y: number, partial: Partial<FlowNode> = {}): FlowNode {
  return { id, name: id, x: 0, y, request: createRequest({ url: `https://api.test/${id}` }), extractions: [], expectedStatus: '', continueOnError: false, ...partial };
}

function flow(nodes: FlowNode[], edges: [string, string][], stopOnError = true): Flow {
  return {
    id: 'f',
    name: 'f',
    description: '',
    nodes,
    edges: edges.map(([from, to], i) => ({ id: `e${i}`, from, to })),
    variables: [{ id: 'v', key: 'base', value: 'https://api.test', enabled: true }],
    stopOnError,
    createdAt: 0,
    updatedAt: 0,
  };
}

describe('executionOrder', () => {
  it('orders topologically, breaking ties visually', () => {
    const f = flow([node('c', 300), node('a', 0), node('b', 100), node('d', 50)], [['a', 'b'], ['b', 'c']]);
    expect(executionOrder(f).map((n) => n.id)).toEqual(['a', 'd', 'b', 'c']);
  });

  it('detects cycles', () => {
    expect(() => executionOrder(flow([node('a', 0), node('b', 1)], [['a', 'b'], ['b', 'a']]))).toThrow(FlowCycleError);
  });
});

describe('runFlow', () => {
  it('runs steps in order and passes extracted variables along', async () => {
    const login = node('login', 0, { extractions: [extraction({ name: 'token', expression: '$.accessToken', expectedType: 'string' })] });
    const me = node('me', 100, { request: createRequest({ url: '{{base}}/me', headers: [{ id: 'h', key: 'Authorization', value: 'Bearer {{token}}', enabled: true }] }) });
    const seen: string[] = [];
    const exec: StepExecutor = async (n, req, vars) => {
      seen.push(`${interpolate(req.url, vars)} ${interpolate(req.headers[0]?.value ?? '', vars)}`.trim());
      return n.id === 'login'
        ? { kind: 'response', status: 200, headers: [], body: '{"accessToken":"T0K"}', durationMs: 5, resolvedUrl: '' }
        : { kind: 'response', status: 200, headers: [], body: '{}', durationMs: 3, resolvedUrl: '' };
    };
    const updates: FlowRun[] = [];
    const run = await runFlow(flow([login, me], [['login', 'me']]), exec, (r) => updates.push(r), new AbortController().signal);
    expect(run.status).toBe('success');
    expect(seen).toEqual(['https://api.test/login', 'https://api.test/me Bearer T0K']);
    expect(run.variables['token']).toBe('T0K');
    expect(run.path).toEqual(['login', 'me']);
    expect(updates.some((u) => u.steps['login'].status === 'running')).toBe(true);
  });

  it('stops on error and skips the remaining steps', async () => {
    const exec: StepExecutor = async (n) =>
      n.id === 'b' ? { kind: 'response', status: 500, headers: [], body: '', durationMs: 1, resolvedUrl: '' } : { kind: 'response', status: 200, headers: [], body: '', durationMs: 1, resolvedUrl: '' };
    const run = await runFlow(flow([node('a', 0), node('b', 1), node('c', 2), node('d', 3)], [['a', 'b'], ['b', 'c']]), exec, () => undefined, new AbortController().signal);
    expect(run.status).toBe('failed');
    expect(run.steps['b']).toMatchObject({ status: 'failed', error: 'Unexpected status 500' });
    expect(run.steps['c'].status).toBe('skipped');
    expect(run.steps['d'].status).toBe('skipped');
  });

  it('continues independent branches when stopOnError is off', async () => {
    const exec: StepExecutor = async (n) =>
      n.id === 'a' ? { kind: 'error', message: 'DNS failure', durationMs: 1 } : { kind: 'response', status: 200, headers: [], body: '', durationMs: 1, resolvedUrl: '' };
    const run = await runFlow(flow([node('a', 0), node('b', 1), node('c', 2)], [['a', 'b']], false), exec, () => undefined, new AbortController().signal);
    expect(run.steps['a']).toMatchObject({ status: 'failed', error: 'DNS failure' });
    expect(run.steps['b'].status).toBe('skipped');
    expect(run.steps['c'].status).toBe('success');
  });

  it('fails the step when a required extraction is missing', async () => {
    const n = node('a', 0, { extractions: [extraction({ name: 'id', expression: '$.id' })] });
    const exec: StepExecutor = async () => ({ kind: 'response', status: 200, headers: [], body: '{}', durationMs: 1, resolvedUrl: '' });
    const run = await runFlow(flow([n], []), exec, () => undefined, new AbortController().signal);
    expect(run.steps['a'].status).toBe('failed');
    expect(run.steps['a'].extractionErrors[0]).toMatch(/not found/);
  });

  it('allows continuing after a failing step when configured', async () => {
    const exec: StepExecutor = async (n) => ({ kind: 'response', status: n.id === 'a' ? 404 : 200, headers: [], body: '', durationMs: 1, resolvedUrl: '' });
    const run = await runFlow(flow([node('a', 0, { continueOnError: true }), node('b', 1)], [['a', 'b']]), exec, () => undefined, new AbortController().signal);
    expect(run.steps['b'].status).toBe('success');
  });

  it('can be cancelled', async () => {
    const controller = new AbortController();
    const exec: StepExecutor = async () => {
      controller.abort();
      return { kind: 'error', message: 'cancelled', durationMs: 1 };
    };
    const run = await runFlow(flow([node('a', 0), node('b', 1)], [['a', 'b']]), exec, () => undefined, controller.signal);
    expect(run.status).toBe('cancelled');
    expect(run.steps['b'].status).toBe('skipped');
  });
});
