/**
 * Small, dependency-free JSONPath implementation covering the common subset:
 *   $  .key  ['key']  [0]  [-1]  [*]  .*  ..key  [0,2]  [1:3]  [?(@.field == value)]
 * and RFC 6901 JSON Pointer.
 */

type Segment =
  | { type: 'key'; key: string }
  | { type: 'index'; indexes: number[] }
  | { type: 'slice'; start?: number; end?: number }
  | { type: 'wildcard' }
  | { type: 'recursive'; key: string | null }
  | { type: 'filter'; field: string[]; op: string | null; value?: unknown };

export class JsonPathError extends Error {}

function parseLiteral(raw: string): unknown {
  const v = raw.trim();
  if (/^'.*'$/.test(v) || /^".*"$/.test(v)) return v.slice(1, -1);
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (v === 'null') return null;
  if (v !== '' && !Number.isNaN(Number(v))) return Number(v);
  throw new JsonPathError(`Invalid literal in filter: ${raw}`);
}

export function parseJsonPath(expression: string): Segment[] {
  const expr = expression.trim();
  if (!expr.startsWith('$')) throw new JsonPathError('JSONPath must start with "$"');
  const segments: Segment[] = [];
  let i = 1;
  const readName = (): string => {
    const match = /^[A-Za-z0-9_$-]+/.exec(expr.slice(i));
    if (!match) throw new JsonPathError(`Expected property name at position ${i}`);
    i += match[0].length;
    return match[0];
  };
  while (i < expr.length) {
    if (expr.startsWith('..', i)) {
      i += 2;
      if (expr[i] === '*') {
        i++;
        segments.push({ type: 'recursive', key: null });
      } else if (expr[i] === '[') {
        segments.push({ type: 'recursive', key: null });
      } else {
        segments.push({ type: 'recursive', key: readName() });
      }
    } else if (expr[i] === '.') {
      i++;
      if (expr[i] === '*') {
        i++;
        segments.push({ type: 'wildcard' });
      } else {
        segments.push({ type: 'key', key: readName() });
      }
    } else if (expr[i] === '[') {
      const end = findClosingBracket(expr, i);
      const inner = expr.slice(i + 1, end).trim();
      i = end + 1;
      if (inner === '*') segments.push({ type: 'wildcard' });
      else if (/^'.*'$|^".*"$/.test(inner)) segments.push({ type: 'key', key: inner.slice(1, -1) });
      else if (/^-?\d+(\s*,\s*-?\d+)*$/.test(inner)) segments.push({ type: 'index', indexes: inner.split(',').map((n) => Number(n.trim())) });
      else if (/^-?\d*\s*:\s*-?\d*$/.test(inner)) {
        const [s, e] = inner.split(':').map((n) => n.trim());
        segments.push({ type: 'slice', start: s ? Number(s) : undefined, end: e ? Number(e) : undefined });
      } else if (inner.startsWith('?(') && inner.endsWith(')')) {
        segments.push(parseFilter(inner.slice(2, -1)));
      } else throw new JsonPathError(`Unsupported selector [${inner}]`);
    } else {
      throw new JsonPathError(`Unexpected character "${expr[i]}" at position ${i}`);
    }
  }
  return segments;
}

function findClosingBracket(expr: string, start: number): number {
  let quote: string | null = null;
  let depth = 0;
  for (let j = start; j < expr.length; j++) {
    const c = expr[j];
    if (quote) {
      if (c === quote) quote = null;
    } else if (c === "'" || c === '"') quote = c;
    else if (c === '[' || c === '(') depth++;
    else if (c === ']' || c === ')') {
      depth--;
      if (depth === 0 && c === ']') return j;
    }
  }
  throw new JsonPathError('Unclosed bracket');
}

function parseFilter(body: string): Segment {
  const match = /^@((?:\.[A-Za-z0-9_$-]+)+)\s*(==|!=|>=|<=|>|<)?\s*(.*)$/.exec(body.trim());
  if (!match) throw new JsonPathError(`Unsupported filter: ${body}`);
  const field = match[1].slice(1).split('.');
  if (!match[2]) return { type: 'filter', field, op: null };
  return { type: 'filter', field, op: match[2], value: parseLiteral(match[3]) };
}

function children(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return Object.values(value);
  return [];
}

function descendants(value: unknown, acc: unknown[] = []): unknown[] {
  acc.push(value);
  for (const child of children(value)) descendants(child, acc);
  return acc;
}

function getField(value: unknown, field: string[]): unknown {
  let current = value;
  for (const f of field) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[f];
  }
  return current;
}

function compare(a: unknown, op: string, b: unknown): boolean {
  switch (op) {
    case '==':
      return a === b;
    case '!=':
      return a !== b;
    case '>':
      return (a as number) > (b as number);
    case '<':
      return (a as number) < (b as number);
    case '>=':
      return (a as number) >= (b as number);
    case '<=':
      return (a as number) <= (b as number);
  }
  return false;
}

function apply(segment: Segment, nodes: unknown[]): unknown[] {
  const out: unknown[] = [];
  for (const node of nodes) {
    switch (segment.type) {
      case 'key':
        if (node && typeof node === 'object' && !Array.isArray(node) && Object.prototype.hasOwnProperty.call(node, segment.key)) {
          out.push((node as Record<string, unknown>)[segment.key]);
        }
        break;
      case 'index':
        if (Array.isArray(node)) {
          for (const idx of segment.indexes) {
            const real = idx < 0 ? node.length + idx : idx;
            if (real >= 0 && real < node.length) out.push(node[real]);
          }
        }
        break;
      case 'slice':
        if (Array.isArray(node)) out.push(...node.slice(segment.start, segment.end));
        break;
      case 'wildcard':
        out.push(...children(node));
        break;
      case 'recursive':
        for (const d of descendants(node)) {
          if (segment.key === null) {
            if (d !== node) out.push(d);
          } else if (d && typeof d === 'object' && !Array.isArray(d) && Object.prototype.hasOwnProperty.call(d, segment.key)) {
            out.push((d as Record<string, unknown>)[segment.key]);
          }
        }
        break;
      case 'filter':
        for (const child of children(node)) {
          const v = getField(child, segment.field);
          if (segment.op === null ? v !== undefined && v !== null && v !== false : compare(v, segment.op, segment.value)) out.push(child);
        }
        break;
    }
  }
  return out;
}

export interface QueryResult {
  /** True when the expression can return several values (wildcards, filters...). */
  multiple: boolean;
  values: unknown[];
}

export function queryJsonPath(data: unknown, expression: string): QueryResult {
  const segments = parseJsonPath(expression);
  let nodes: unknown[] = [data];
  for (const segment of segments) nodes = apply(segment, nodes);
  const multiple = segments.some(
    (s) => s.type === 'wildcard' || s.type === 'recursive' || s.type === 'filter' || s.type === 'slice' || (s.type === 'index' && s.indexes.length > 1),
  );
  return { multiple, values: nodes };
}

/** Evaluates a JSONPath: single-value paths return the value (or undefined), multi-value paths an array. */
export function evaluateJsonPath(data: unknown, expression: string): unknown {
  const result = queryJsonPath(data, expression);
  return result.multiple ? result.values : result.values[0];
}

/** RFC 6901 JSON Pointer. Returns `undefined` when the target does not exist. */
export function evaluateJsonPointer(data: unknown, pointer: string): unknown {
  if (pointer === '' || pointer === '#') return data;
  const raw = pointer.startsWith('#') ? decodeURIComponent(pointer.slice(1)) : pointer;
  if (!raw.startsWith('/')) throw new JsonPathError('JSON Pointer must start with "/"');
  let current: unknown = data;
  for (const token of raw.slice(1).split('/').map((t) => t.replace(/~1/g, '/').replace(/~0/g, '~'))) {
    if (Array.isArray(current)) {
      if (!/^(0|[1-9]\d*)$/.test(token)) return undefined;
      current = current[Number(token)];
    } else if (current && typeof current === 'object') {
      if (!Object.prototype.hasOwnProperty.call(current, token)) return undefined;
      current = (current as Record<string, unknown>)[token];
    } else {
      return undefined;
    }
  }
  return current;
}
