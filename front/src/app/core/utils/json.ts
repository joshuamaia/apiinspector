import type { JsonType } from '../models/drift.model';

export interface JsonValidation {
  valid: boolean;
  value?: unknown;
  error?: { message: string; line: number; column: number; position: number };
}

function lineColumn(text: string, position: number): { line: number; column: number } {
  const before = text.slice(0, position);
  const lines = before.split('\n');
  return { line: lines.length, column: lines[lines.length - 1].length + 1 };
}

/** Parses JSON returning a precise error location (line/column) on failure. */
export function validateJson(text: string): JsonValidation {
  if (!text.trim()) return { valid: false, error: { message: 'Empty document', line: 1, column: 1, position: 0 } };
  try {
    return { valid: true, value: JSON.parse(text) };
  } catch (err) {
    const message = (err as Error).message;
    const lc = /line (\d+) column (\d+)/i.exec(message);
    const pos = /position (\d+)/i.exec(message);
    let position = pos ? Number(pos[1]) : text.length;
    let line: number;
    let column: number;
    if (lc) {
      line = Number(lc[1]);
      column = Number(lc[2]);
      if (!pos) {
        const lines = text.split('\n');
        position = lines.slice(0, line - 1).reduce((n, l) => n + l.length + 1, 0) + column - 1;
      }
    } else {
      ({ line, column } = lineColumn(text, position));
    }
    const clean = message.replace(/^JSON\.parse: /, '').replace(/\s*\(line \d+ column \d+\)/, '').replace(/ in JSON at position \d+/, '');
    return { valid: false, error: { message: clean, line, column, position } };
  }
}

export function tryParseJson(text: string | null | undefined): { ok: true; value: unknown } | { ok: false } {
  if (text === null || text === undefined || !text.trim()) return { ok: false };
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

/** Pretty prints JSON text; returns the input unchanged when it is not valid JSON. */
export function formatJson(text: string, indent = 2): string {
  const parsed = tryParseJson(text);
  return parsed.ok ? JSON.stringify(parsed.value, null, indent) : text;
}

export function minifyJson(text: string): string {
  const parsed = tryParseJson(text);
  return parsed.ok ? JSON.stringify(parsed.value) : text;
}

export function jsonTypeOf(value: unknown): JsonType {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  const t = typeof value;
  if (t === 'string' || t === 'number' || t === 'boolean') return t;
  return 'object';
}

export function isJsonContentType(contentType: string | null | undefined): boolean {
  return !!contentType && /(^application\/json|\+json\b|^text\/json)/i.test(contentType.trim());
}

/** Formats a JS property name as a path segment (`.name` or `['na me']`). */
export function pathSegment(key: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(key) ? `.${key}` : `['${key.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}']`;
}
