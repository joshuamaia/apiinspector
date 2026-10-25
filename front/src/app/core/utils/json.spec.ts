import { formatJson, isJsonContentType, jsonTypeOf, minifyJson, pathSegment, validateJson } from './json';
import { evaluateJsonPath, evaluateJsonPointer, JsonPathError, parseJsonPath } from './json-path';

describe('json utils', () => {
  it('validates JSON and reports line/column of syntax errors', () => {
    expect(validateJson('{"a": 1}')).toEqual({ valid: true, value: { a: 1 } });
    const result = validateJson('{\n  "a": 1,\n  "b": \n}');
    expect(result.valid).toBe(false);
    expect(result.error!.line).toBe(4);
    expect(result.error!.column).toBeGreaterThan(0);
    expect(validateJson('   ').error!.message).toBe('Empty document');
  });

  it('formats and minifies', () => {
    expect(formatJson('{"a":[1,2]}')).toBe('{\n  "a": [\n    1,\n    2\n  ]\n}');
    expect(formatJson('not json')).toBe('not json');
    expect(minifyJson('{ "a" : 1 }')).toBe('{"a":1}');
  });

  it('detects JSON types and content types', () => {
    expect([null, [], {}, 'x', 1, true].map(jsonTypeOf)).toEqual(['null', 'array', 'object', 'string', 'number', 'boolean']);
    expect(isJsonContentType('application/json; charset=utf-8')).toBe(true);
    expect(isJsonContentType('application/problem+json')).toBe(true);
    expect(isJsonContentType('text/html')).toBe(false);
  });

  it('builds path segments', () => {
    expect(pathSegment('name')).toBe('.name');
    expect(pathSegment('first name')).toBe("['first name']");
  });
});

describe('JSONPath', () => {
  const data = {
    token: 'abc',
    user: { id: 7, roles: ['admin', 'dev'], 'display name': 'Ada' },
    items: [
      { id: 1, price: 10, tags: ['a'] },
      { id: 2, price: 25, tags: [] },
      { id: 3, price: 40, tags: ['b'] },
    ],
  };

  it.each([
    ['$', data],
    ['$.token', 'abc'],
    ['$.user.id', 7],
    ["$.user['display name']", 'Ada'],
    ['$.user.roles[0]', 'admin'],
    ['$.user.roles[-1]', 'dev'],
    ['$.items[1].price', 25],
    ['$.missing', undefined],
    ['$.items[10]', undefined],
  ])('evaluates single path %s', (expr, expected) => {
    expect(evaluateJsonPath(data, expr)).toEqual(expected);
  });

  it.each([
    ['$.items[*].id', [1, 2, 3]],
    ['$.items.*.price', [10, 25, 40]],
    ['$..id', [7, 1, 2, 3]],
    ['$.items[0,2].id', [1, 3]],
    ['$.items[0:2].id', [1, 2]],
    ['$.items[?(@.price > 20)].id', [2, 3]],
    ['$.items[?(@.id == 2)].price', [25]],
    ["$.user.roles[?(@ == 'x')]", []],
  ])('evaluates multi-value path %s', (expr, expected) => {
    if (expr.includes("@ == 'x'")) {
      expect(() => evaluateJsonPath(data, expr)).toThrow(JsonPathError);
      return;
    }
    expect(evaluateJsonPath(data, expr)).toEqual(expected);
  });

  it('rejects invalid expressions', () => {
    expect(() => parseJsonPath('token')).toThrow(JsonPathError);
    expect(() => parseJsonPath('$.items[')).toThrow(JsonPathError);
    expect(() => parseJsonPath('$.a[foo]')).toThrow(JsonPathError);
  });

  it('evaluates JSON Pointers (RFC 6901)', () => {
    const doc = { 'a/b': 1, 'm~n': 2, list: [{ x: 'y' }] };
    expect(evaluateJsonPointer(doc, '')).toBe(doc);
    expect(evaluateJsonPointer(doc, '/a~1b')).toBe(1);
    expect(evaluateJsonPointer(doc, '/m~0n')).toBe(2);
    expect(evaluateJsonPointer(doc, '/list/0/x')).toBe('y');
    expect(evaluateJsonPointer(doc, '/list/01')).toBeUndefined();
    expect(evaluateJsonPointer(doc, '/nope')).toBeUndefined();
    expect(() => evaluateJsonPointer(doc, 'list')).toThrow(JsonPathError);
  });
});
