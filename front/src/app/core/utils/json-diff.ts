import { jsonTypeOf, pathSegment } from './json';

export type ChangeKind = 'added' | 'removed' | 'modified' | 'type-changed';

export interface DiffChange {
  index: number;
  path: string;
  kind: ChangeKind;
  left?: unknown;
  right?: unknown;
}

export interface DiffOptions {
  arrayStrategy: 'index' | 'key';
  /** Property used to match array items when `arrayStrategy === 'key'`. */
  arrayKey: string;
  /** Paths to ignore: `$.meta.*`, `$..updatedAt`, `$.items[*].id` or a bare property name. */
  ignorePaths: string[];
  ignoreTimestamps: boolean;
  ignoreUuids: boolean;
  /** Ignore value changes in identifier fields (`id`, `*Id`, `*_id`). */
  ignoreIds: boolean;
}

export const DEFAULT_DIFF_OPTIONS: DiffOptions = {
  arrayStrategy: 'index',
  arrayKey: 'id',
  ignorePaths: [],
  ignoreTimestamps: false,
  ignoreUuids: false,
  ignoreIds: false,
};

export type TokenType = 'key' | 'string' | 'number' | 'boolean' | 'null' | 'punct';

export interface DiffLine {
  no: number;
  indent: number;
  key?: string;
  text: string;
  textType: TokenType;
  comma: boolean;
}

export type RowKind = 'equal' | 'ignored' | ChangeKind;

export interface DiffRow {
  kind: RowKind;
  left: DiffLine | null;
  right: DiffLine | null;
  /** Set on the first row of each change block (used for navigation). */
  changeIndex?: number;
}

export interface JsonDiffResult {
  changes: DiffChange[];
  rows: DiffRow[];
  ignoredCount: number;
  stats: Record<ChangeKind, number>;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ID_KEY = /^(id|_id|uuid|guid)$|(Id|_id|ID|Uuid)$/;
const TIME_KEY = /(date|time|At$|_at$|timestamp|expires|created|updated|modified)/i;

function isTimestamp(value: unknown, key: string | null): boolean {
  if (typeof value === 'string') return ISO_DATE.test(value) || (!!key && TIME_KEY.test(key) && !Number.isNaN(Date.parse(value)));
  if (typeof value === 'number') return !!key && TIME_KEY.test(key) && (/^\d{10}$/.test(String(value)) || /^\d{13}$/.test(String(value)));
  return false;
}

/** Converts an ignore pattern into a regex over diff paths (also matching descendants). */
export function compileIgnorePattern(pattern: string): RegExp {
  let p = pattern.trim();
  if (!p) return /^(?!)$/;
  if (!p.startsWith('$')) p = /^[\w$-]+$/.test(p) ? `$..${p}` : `$.${p}`;
  let regex = '';
  for (let i = 0; i < p.length; i++) {
    const rest = p.slice(i);
    if (rest.startsWith('..')) {
      regex += '(?:.*)?\\.';
      i += 1;
    } else if (rest.startsWith('[*]') || rest.startsWith('[]')) {
      regex += '\\[[^\\]]*\\]';
      i += rest.startsWith('[*]') ? 2 : 1;
    } else if (rest.startsWith('*')) {
      regex += '[^.\\[]+';
    } else {
      regex += p[i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${regex}(?=$|[.\\[])`);
}

function sameScalar(a: unknown, b: unknown): boolean {
  return a === b || (Number.isNaN(a) && Number.isNaN(b));
}

function isContainer(value: unknown): value is Record<string, unknown> | unknown[] {
  return value !== null && typeof value === 'object';
}

function tokenType(value: unknown): TokenType {
  const t = jsonTypeOf(value);
  return t === 'object' || t === 'array' ? 'punct' : (t as TokenType);
}

/**
 * Merges two ordered key lists, keeping left order and placing right-only keys
 * after their right-side predecessor (and after left-only keys that follow it,
 * so a removal is shown before the addition that replaced it).
 */
export function mergeKeys(left: string[], right: string[]): string[] {
  const result = [...left];
  const inResult = new Set(result);
  const inRight = new Set(right);
  let lastIndex = -1;
  for (const key of right) {
    if (inResult.has(key)) {
      lastIndex = result.indexOf(key);
      continue;
    }
    let pos = lastIndex + 1;
    while (pos < result.length && !inRight.has(result[pos])) pos++;
    result.splice(pos, 0, key);
    inResult.add(key);
    lastIndex = pos;
  }
  return result;
}

class DiffBuilder {
  readonly rows: DiffRow[] = [];
  readonly changes: DiffChange[] = [];
  ignoredCount = 0;
  private leftNo = 0;
  private rightNo = 0;
  private readonly ignore: RegExp[];

  constructor(private readonly options: DiffOptions) {
    this.ignore = options.ignorePaths.map(compileIgnorePattern);
  }

  private isIgnoredPath(path: string): boolean {
    return this.ignore.some((r) => r.test(path));
  }

  private line(side: 'left' | 'right', indent: number, key: string | undefined, text: string, textType: TokenType, comma: boolean): DiffLine {
    const no = side === 'left' ? ++this.leftNo : ++this.rightNo;
    return { no, indent, key, text, textType, comma };
  }

  /** Pretty prints a value as lines for one side. */
  private linesOf(side: 'left' | 'right', value: unknown, key: string | undefined, indent: number, comma: boolean): DiffLine[] {
    if (isContainer(value)) {
      const isArray = Array.isArray(value);
      const entries: [string | undefined, unknown][] = isArray ? value.map((v) => [undefined, v]) : Object.entries(value);
      if (entries.length === 0) return [this.line(side, indent, key, isArray ? '[]' : '{}', 'punct', comma)];
      const lines = [this.line(side, indent, key, isArray ? '[' : '{', 'punct', false)];
      entries.forEach(([k, v], i) => lines.push(...this.linesOf(side, v, k, indent + 1, i < entries.length - 1)));
      lines.push(this.line(side, indent, undefined, isArray ? ']' : '}', 'punct', comma));
      return lines;
    }
    return [this.line(side, indent, key, JSON.stringify(value) ?? 'null', tokenType(value), comma)];
  }

  private pushBlock(kind: RowKind, left: DiffLine[], right: DiffLine[], changeIndex?: number): void {
    const n = Math.max(left.length, right.length);
    for (let i = 0; i < n; i++) {
      this.rows.push({ kind, left: left[i] ?? null, right: right[i] ?? null, ...(i === 0 && changeIndex !== undefined ? { changeIndex } : {}) });
    }
  }

  private addChange(change: Omit<DiffChange, 'index'>): number {
    const index = this.changes.length;
    this.changes.push({ index, ...change });
    return index;
  }

  private dynamicEqual(left: unknown, right: unknown, key: string | undefined): boolean {
    if (this.options.ignoreTimestamps && isTimestamp(left, key ?? null) && isTimestamp(right, key ?? null)) return true;
    if (this.options.ignoreUuids && typeof left === 'string' && typeof right === 'string' && UUID.test(left) && UUID.test(right)) return true;
    if (this.options.ignoreIds && key && ID_KEY.test(key) && jsonTypeOf(left) === jsonTypeOf(right) && !isContainer(left)) return true;
    return false;
  }

  walk(left: unknown, right: unknown, key: string | undefined, indent: number, commaL: boolean, commaR: boolean, path: string): void {
    if (path !== '$' && this.isIgnoredPath(path)) {
      if (JSON.stringify(left) !== JSON.stringify(right)) this.ignoredCount++;
      this.pushBlock('ignored', this.linesOf('left', left, key, indent, commaL), this.linesOf('right', right, key, indent, commaR));
      return;
    }

    const lt = jsonTypeOf(left);
    const rt = jsonTypeOf(right);

    if (lt === rt && isContainer(left) && isContainer(right)) {
      const isArray = Array.isArray(left);
      const lEmpty = isArray ? (left as unknown[]).length === 0 : Object.keys(left).length === 0;
      const rEmpty = isArray ? (right as unknown[]).length === 0 : Object.keys(right).length === 0;
      if (lEmpty && rEmpty) {
        this.pushBlock('equal', this.linesOf('left', left, key, indent, commaL), this.linesOf('right', right, key, indent, commaR));
        return;
      }
      const open = isArray ? '[' : '{';
      const close = isArray ? ']' : '}';
      this.rows.push({ kind: 'equal', left: this.line('left', indent, key, open, 'punct', false), right: this.line('right', indent, key, open, 'punct', false) });
      if (isArray) this.walkArray(left as unknown[], right as unknown[], indent + 1, path);
      else this.walkObject(left as Record<string, unknown>, right as Record<string, unknown>, indent + 1, path);
      this.rows.push({
        kind: 'equal',
        left: this.line('left', indent, undefined, close, 'punct', commaL),
        right: this.line('right', indent, undefined, close, 'punct', commaR),
      });
      return;
    }

    if (lt === rt && sameScalar(left, right)) {
      this.rows.push({ kind: 'equal', left: this.line('left', indent, key, JSON.stringify(left), tokenType(left), commaL), right: this.line('right', indent, key, JSON.stringify(right), tokenType(right), commaR) });
      return;
    }

    if (this.dynamicEqual(left, right, key)) {
      this.ignoredCount++;
      this.pushBlock('ignored', this.linesOf('left', left, key, indent, commaL), this.linesOf('right', right, key, indent, commaR));
      return;
    }

    const kind: ChangeKind = lt === rt ? 'modified' : 'type-changed';
    const index = this.addChange({ path, kind, left, right });
    this.pushBlock(kind, this.linesOf('left', left, key, indent, commaL), this.linesOf('right', right, key, indent, commaR), index);
  }

  private walkObject(left: Record<string, unknown>, right: Record<string, unknown>, indent: number, path: string): void {
    const lKeys = Object.keys(left);
    const rKeys = Object.keys(right);
    const keys = mergeKeys(lKeys, rKeys);
    const lastL = lKeys[lKeys.length - 1];
    const lastR = rKeys[rKeys.length - 1];
    for (const key of keys) {
      const inL = Object.prototype.hasOwnProperty.call(left, key);
      const inR = Object.prototype.hasOwnProperty.call(right, key);
      const childPath = `${path}${pathSegment(key)}`;
      this.walkMember(inL, inR, left[key], right[key], key, indent, key !== lastL, key !== lastR, childPath);
    }
  }

  private walkMember(inL: boolean, inR: boolean, lv: unknown, rv: unknown, key: string | undefined, indent: number, commaL: boolean, commaR: boolean, path: string): void {
    if (inL && inR) return this.walk(lv, rv, key, indent, commaL, commaR, path);
    if (this.isIgnoredPath(path)) {
      this.ignoredCount++;
      this.pushBlock('ignored', inL ? this.linesOf('left', lv, key, indent, commaL) : [], inR ? this.linesOf('right', rv, key, indent, commaR) : []);
      return;
    }
    if (inL) {
      const index = this.addChange({ path, kind: 'removed', left: lv });
      this.pushBlock('removed', this.linesOf('left', lv, key, indent, commaL), [], index);
    } else {
      const index = this.addChange({ path, kind: 'added', right: rv });
      this.pushBlock('added', [], this.linesOf('right', rv, key, indent, commaR), index);
    }
  }

  private walkArray(left: unknown[], right: unknown[], indent: number, path: string): void {
    const key = this.options.arrayKey;
    const keyed =
      this.options.arrayStrategy === 'key' &&
      key &&
      [...left, ...right].every((item) => isContainer(item) && !Array.isArray(item) && (item as Record<string, unknown>)[key] !== undefined);

    if (!keyed) {
      const n = Math.max(left.length, right.length);
      for (let i = 0; i < n; i++) {
        this.walkMember(i < left.length, i < right.length, left[i], right[i], undefined, indent, i < left.length - 1, i < right.length - 1, `${path}[${i}]`);
      }
      return;
    }

    const idOf = (item: unknown) => JSON.stringify((item as Record<string, unknown>)[key]);
    const lIds = left.map(idOf);
    const rIds = right.map(idOf);
    const order = mergeKeys(lIds, rIds);
    const lastL = lIds[lIds.length - 1];
    const lastR = rIds[rIds.length - 1];
    for (const id of order) {
      const li = lIds.indexOf(id);
      const ri = rIds.indexOf(id);
      const label = /^".*"$/.test(id) ? id.slice(1, -1) : id;
      this.walkMember(li >= 0, ri >= 0, left[li], right[ri], undefined, indent, id !== lastL, id !== lastR, `${path}[${key}=${label}]`);
    }
  }
}

/** Structural diff of two JSON values producing a change list and aligned side-by-side rows. */
export function diffJson(left: unknown, right: unknown, options: Partial<DiffOptions> = {}): JsonDiffResult {
  const builder = new DiffBuilder({ ...DEFAULT_DIFF_OPTIONS, ...options });
  builder.walk(left, right, undefined, 0, false, false, '$');
  const stats: Record<ChangeKind, number> = { added: 0, removed: 0, modified: 0, 'type-changed': 0 };
  for (const c of builder.changes) stats[c.kind]++;
  return { changes: builder.changes, rows: builder.rows, ignoredCount: builder.ignoredCount, stats };
}

export interface HeaderDiff {
  name: string;
  kind: ChangeKind | 'equal';
  left?: string;
  right?: string;
}

/** Compares two header lists case-insensitively. */
export function diffHeaders(left: [string, string][], right: [string, string][], ignore: string[] = []): HeaderDiff[] {
  const toMap = (headers: [string, string][]) => {
    const map = new Map<string, { name: string; value: string }>();
    for (const [k, v] of headers) {
      const lower = k.toLowerCase();
      const existing = map.get(lower);
      map.set(lower, { name: existing?.name ?? k, value: existing ? `${existing.value}, ${v}` : v });
    }
    return map;
  };
  const l = toMap(left);
  const r = toMap(right);
  const ignored = new Set(ignore.map((i) => i.toLowerCase()));
  const names = mergeKeys([...l.keys()], [...r.keys()]);
  return names
    .filter((n) => !ignored.has(n))
    .map((n): HeaderDiff => {
      const lv = l.get(n);
      const rv = r.get(n);
      if (lv && rv) return { name: rv.name, kind: lv.value === rv.value ? 'equal' : 'modified', left: lv.value, right: rv.value };
      if (lv) return { name: lv.name, kind: 'removed', left: lv.value };
      return { name: rv!.name, kind: 'added', right: rv!.value };
    });
}

export interface TextDiffRow {
  kind: 'equal' | 'added' | 'removed';
  left: { no: number; text: string } | null;
  right: { no: number; text: string } | null;
}

/** Line based diff (LCS) for non-JSON bodies. Large inputs fall back to a positional comparison. */
export function diffText(leftText: string, rightText: string, maxCells = 4_000_000): TextDiffRow[] {
  const a = leftText.split('\n');
  const b = rightText.split('\n');
  const rows: TextDiffRow[] = [];
  if (a.length * b.length > maxCells) {
    const n = Math.max(a.length, b.length);
    for (let i = 0; i < n; i++) {
      if (a[i] === b[i]) rows.push({ kind: 'equal', left: { no: i + 1, text: a[i] }, right: { no: i + 1, text: b[i] } });
      else {
        if (i < a.length) rows.push({ kind: 'removed', left: { no: i + 1, text: a[i] }, right: null });
        if (i < b.length) rows.push({ kind: 'added', left: null, right: { no: i + 1, text: b[i] } });
      }
    }
    return rows;
  }
  const dp: Uint32Array[] = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  }
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      rows.push({ kind: 'equal', left: { no: i + 1, text: a[i] }, right: { no: j + 1, text: b[j] } });
      i++;
      j++;
    } else if (j < b.length && (i >= a.length || dp[i][j + 1] >= dp[i + 1][j])) {
      rows.push({ kind: 'added', left: null, right: { no: j + 1, text: b[j] } });
      j++;
    } else {
      rows.push({ kind: 'removed', left: { no: i + 1, text: a[i] }, right: null });
      i++;
    }
  }
  return rows;
}
