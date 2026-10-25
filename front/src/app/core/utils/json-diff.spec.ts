import { compileIgnorePattern, diffHeaders, diffJson, diffText, mergeKeys } from './json-diff';

describe('diffJson', () => {
  it('reports no changes for equal documents', () => {
    const result = diffJson({ a: 1, b: [1, { c: true }] }, { a: 1, b: [1, { c: true }] });
    expect(result.changes).toEqual([]);
    expect(result.rows.every((r) => r.kind === 'equal')).toBe(true);
    expect(result.rows.every((r) => r.left && r.right)).toBe(true);
  });

  it('detects added, removed, modified and type-changed fields', () => {
    const left = { diagnostics: null, extras: { apiKey: 'DEMO' }, enabled: false, count: 1 };
    const right = { diagnostics: { issues: 2 }, extras: { APIKey: 'DEMO' }, enabled: true, count: 1 };
    const { changes, stats } = diffJson(left, right);
    expect(changes.map((c) => [c.kind, c.path])).toEqual([
      ['type-changed', '$.diagnostics'],
      ['removed', '$.extras.apiKey'],
      ['added', '$.extras.APIKey'],
      ['modified', '$.enabled'],
    ]);
    expect(stats).toEqual({ added: 1, removed: 1, modified: 1, 'type-changed': 1 });
  });

  it('aligns rows and pads the shorter side', () => {
    const { rows } = diffJson({ a: 1 }, { a: 1, b: { x: 1, y: 2 } });
    const added = rows.filter((r) => r.kind === 'added');
    expect(added).toHaveLength(4); // "b": {, x, y, }
    expect(added.every((r) => r.left === null && r.right !== null)).toBe(true);
    expect(added[0].changeIndex).toBe(0);
    // line numbers are continuous on each side
    const rightNos = rows.filter((r) => r.right).map((r) => r.right!.no);
    expect(rightNos).toEqual(rightNos.map((_, i) => i + 1));
    // trailing comma moves to the previous last key on the right side
    const aRow = rows.find((r) => r.left?.key === 'a')!;
    expect(aRow.left!.comma).toBe(false);
    expect(aRow.right!.comma).toBe(true);
  });

  it('compares arrays by position', () => {
    const { changes } = diffJson({ tags: ['temp', 'debug'] }, { tags: ['debug', 'temp', 'cache'] });
    expect(changes.map((c) => [c.kind, c.path])).toEqual([
      ['modified', '$.tags[0]'],
      ['modified', '$.tags[1]'],
      ['added', '$.tags[2]'],
    ]);
  });

  it('compares arrays by identifier key', () => {
    const left = { users: [{ id: 1, name: 'Ada' }, { id: 2, name: 'Alan' }] };
    const right = { users: [{ id: 2, name: 'Alan T.' }, { id: 3, name: 'Grace' }] };
    const { changes } = diffJson(left, right, { arrayStrategy: 'key', arrayKey: 'id' });
    expect(changes.map((c) => [c.kind, c.path])).toEqual([
      ['removed', '$.users[id=1]'],
      ['modified', '$.users[id=2].name'],
      ['added', '$.users[id=3]'],
    ]);
  });

  it('falls back to positional comparison when items lack the key', () => {
    const { changes } = diffJson([{ a: 1 }], [{ a: 2 }], { arrayStrategy: 'key', arrayKey: 'id' });
    expect(changes[0].path).toBe('$[0].a');
  });

  it('ignores configured paths and dynamic values', () => {
    const left = { meta: { requestId: 'a' }, updatedAt: '2024-01-01T10:00:00Z', uuid: '3f2b8c1e-1d2a-4b3c-9d8e-7f6a5b4c3d2e', items: [{ id: 1, at: 1 }] };
    const right = { meta: { requestId: 'b' }, updatedAt: '2025-08-18T07:10:00Z', uuid: '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d', items: [{ id: 2, at: 1 }] };
    expect(diffJson(left, right).changes).toHaveLength(4);
    const result = diffJson(left, right, { ignorePaths: ['$.meta'], ignoreTimestamps: true, ignoreUuids: true, ignoreIds: true });
    expect(result.changes).toEqual([]);
    expect(result.ignoredCount).toBe(4);
    expect(result.rows.some((r) => r.kind === 'ignored')).toBe(true);
  });

  it('compiles ignore patterns', () => {
    expect(compileIgnorePattern('$.meta.*').test('$.meta.requestId')).toBe(true);
    expect(compileIgnorePattern('$.meta.*').test('$.metadata')).toBe(false);
    expect(compileIgnorePattern('$..updatedAt').test('$.data.items[3].updatedAt')).toBe(true);
    expect(compileIgnorePattern('updatedAt').test('$.updatedAt')).toBe(true);
    expect(compileIgnorePattern('$.items[*].id').test('$.items[4].id')).toBe(true);
    expect(compileIgnorePattern('$.items[].id').test('$.items[id=4].id')).toBe(true);
    expect(compileIgnorePattern('$.a').test('$.ab')).toBe(false);
    expect(compileIgnorePattern('$.a').test('$.a.b')).toBe(true);
  });

  it('handles root type changes and scalars', () => {
    expect(diffJson([1], { a: 1 }).changes[0]).toMatchObject({ path: '$', kind: 'type-changed' });
    expect(diffJson('x', 'y').changes[0]).toMatchObject({ path: '$', kind: 'modified' });
  });
});

describe('mergeKeys', () => {
  it('keeps left order and inserts right-only keys after removed neighbours', () => {
    expect(mergeKeys(['a', 'b', 'c'], ['a', 'x', 'c', 'y'])).toEqual(['a', 'b', 'x', 'c', 'y']);
    expect(mergeKeys(['a', 'b'], ['x', 'a', 'b'])).toEqual(['x', 'a', 'b']);
  });
});

describe('diffHeaders', () => {
  it('compares headers case-insensitively and supports ignore lists', () => {
    const result = diffHeaders(
      [['Content-Type', 'application/json'], ['X-Old', '1'], ['Date', 'a']],
      [['content-type', 'application/json; charset=utf-8'], ['X-New', '2'], ['date', 'b']],
      ['date'],
    );
    expect(result.map((h) => [h.name.toLowerCase(), h.kind])).toEqual([
      ['content-type', 'modified'],
      ['x-old', 'removed'],
      ['x-new', 'added'],
    ]);
  });
});

describe('diffText', () => {
  it('produces a line diff', () => {
    const rows = diffText('a\nb\nc', 'a\nc\nd');
    expect(rows.map((r) => r.kind)).toEqual(['equal', 'removed', 'equal', 'added']);
  });
});
