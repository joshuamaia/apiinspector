import type { ExpectedType, FlowExtraction } from '../models/flow.model';
import { evaluateJsonPath, evaluateJsonPointer, JsonPathError } from './json-path';
import { jsonTypeOf, tryParseJson } from './json';

export interface ExtractionSource {
  status: number;
  headers: [string, string][];
  body: string;
}

export interface ExtractionResult {
  ok: boolean;
  value?: unknown;
  error?: string;
}

function matchesType(value: unknown, expected: ExpectedType): boolean {
  if (expected === 'any') return true;
  return jsonTypeOf(value) === expected;
}

/** Extracts a variable from a response, validating existence and type. */
export function extractValue(source: ExtractionSource, extraction: FlowExtraction): ExtractionResult {
  let value: unknown;
  try {
    if (extraction.source === 'status') {
      value = source.status;
    } else if (extraction.source === 'header') {
      const name = extraction.expression.trim().toLowerCase();
      const values = source.headers.filter(([k]) => k.toLowerCase() === name).map(([, v]) => v);
      value = values.length === 0 ? undefined : values.join(', ');
    } else {
      const parsed = tryParseJson(source.body);
      if (!parsed.ok) return { ok: false, error: 'Response body is not valid JSON' };
      value = extraction.syntax === 'pointer' ? evaluateJsonPointer(parsed.value, extraction.expression.trim()) : evaluateJsonPath(parsed.value, extraction.expression.trim());
    }
  } catch (err) {
    return { ok: false, error: err instanceof JsonPathError ? err.message : `Invalid expression: ${(err as Error).message}` };
  }

  const missing = value === undefined || (Array.isArray(value) && value.length === 0 && /\*|\.\.|\?\(/.test(extraction.expression));
  if (missing) {
    return extraction.required ? { ok: false, error: `"${extraction.expression}" not found in response` } : { ok: true, value: undefined };
  }
  if (!matchesType(value, extraction.expectedType)) {
    return { ok: false, value, error: `Expected ${extraction.expectedType} but got ${jsonTypeOf(value)}` };
  }
  return { ok: true, value };
}

/**
 * Checks a status against an expectation such as `2xx`, `200`, `200,201`,
 * `200-299` or `!5xx`. An empty expectation accepts any status below 400.
 */
export function matchesExpectedStatus(status: number, expectation: string): boolean {
  const expr = expectation.trim();
  if (!expr) return status >= 200 && status < 400;
  return expr.split(',').some((raw) => {
    const part = raw.trim().toLowerCase();
    if (!part) return false;
    if (part.startsWith('!')) return !matchesExpectedStatus(status, part.slice(1));
    if (/^\dxx$/.test(part)) return Math.floor(status / 100) === Number(part[0]);
    const range = /^(\d{3})\s*-\s*(\d{3})$/.exec(part);
    if (range) return status >= Number(range[1]) && status <= Number(range[2]);
    return /^\d{3}$/.test(part) && status === Number(part);
  });
}
