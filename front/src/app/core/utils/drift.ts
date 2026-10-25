import type {
  ContractField,
  DriftFinding,
  DriftReport,
  DriftSeverity,
  DriftVerdict,
  FieldRequirement,
  JsonType,
} from '../models/drift.model';
import { jsonTypeOf, pathSegment } from './json';

interface Observation {
  types: Set<JsonType>;
  /** Number of times the field was present. */
  present: number;
  /** Number of parent objects where the field could have appeared. */
  slots: number;
}

/**
 * Walks a JSON document recording, for every path, the observed types and in
 * how many parent objects the field was present. Array items share the
 * `[]` path, so optional-in-some-items fields can be detected.
 */
function observe(value: unknown): Map<string, Observation> {
  const map = new Map<string, Observation>();
  const get = (path: string) => {
    let o = map.get(path);
    if (!o) {
      o = { types: new Set(), present: 0, slots: 0 };
      map.set(path, o);
    }
    return o;
  };
  const visit = (v: unknown, path: string) => {
    const o = get(path);
    o.present++;
    o.types.add(jsonTypeOf(v));
    if (Array.isArray(v)) {
      const items = get(`${path}[]`);
      items.slots += v.length;
      for (const item of v) visit(item, `${path}[]`);
    } else if (v !== null && typeof v === 'object') {
      for (const [k, child] of Object.entries(v)) visit(child, `${path}${pathSegment(k)}`);
    }
  };
  get('$').slots = 1;
  visit(value, '$');
  // Object members: a slot for every time the parent was an object.
  for (const [path, o] of map) {
    if (path === '$' || path.endsWith('[]')) continue;
    o.slots = countObjects(value, parentPath(path));
  }
  return map;
}

/** Counts how many values at `path` (with `[]` wildcards) are objects. */
function countObjects(root: unknown, path: string): number {
  return valuesAt(root, path).filter((v) => v !== null && typeof v === 'object' && !Array.isArray(v)).length;
}

function tokenize(path: string): string[] {
  const tokens: string[] = [];
  const re = /\.([A-Za-z_$][\w$]*)|\['((?:[^'\\]|\\.)*)'\]|(\[\])/g;
  const body = path.slice(1);
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    if (m[3]) tokens.push('[]');
    else tokens.push(m[1] ?? m[2].replace(/\\(.)/g, '$1'));
  }
  return tokens;
}

function valuesAt(root: unknown, path: string): unknown[] {
  let nodes: unknown[] = [root];
  for (const token of tokenize(path)) {
    const next: unknown[] = [];
    for (const n of nodes) {
      if (token === '[]') {
        if (Array.isArray(n)) next.push(...n);
      } else if (n !== null && typeof n === 'object' && !Array.isArray(n) && Object.prototype.hasOwnProperty.call(n, token)) {
        next.push((n as Record<string, unknown>)[token]);
      }
    }
    nodes = next;
  }
  return nodes;
}

export function parentPath(path: string): string {
  if (path.endsWith('[]')) return path.slice(0, -2);
  const m = /^(.*?)(\.[A-Za-z_$][\w$]*|\['(?:[^'\\]|\\.)*'\])$/.exec(path);
  return m ? m[1] || '$' : '$';
}

function isDescendant(path: string, ancestor: string): boolean {
  return path !== ancestor && (path.startsWith(`${ancestor}.`) || path.startsWith(`${ancestor}[`));
}

/** Infers the contract fields of a reference response. Requirements start as `unspecified`. */
export function inferContract(sample: unknown): ContractField[] {
  const fields: ContractField[] = [];
  for (const [path, o] of observe(sample)) {
    const types = [...o.types].filter((t) => t !== 'null').sort() as JsonType[];
    const isRoot = path === '$';
    const alwaysPresent = isRoot || path.endsWith('[]') || o.present >= o.slots;
    fields.push({ path, types, nullable: o.types.has('null'), alwaysPresent, requirement: isRoot ? 'required' : 'unspecified' });
  }
  return fields;
}

/** Suggests requirements: present in every observed parent and non-null ⇒ required, otherwise optional. */
export function suggestRequirements(sample: unknown, fields: ContractField[]): ContractField[] {
  const obs = observe(sample);
  return fields.map((f) => {
    if (f.path === '$') return f;
    const o = obs.get(f.path);
    const always = !!o && o.slots > 0 && o.present >= o.slots;
    return { ...f, requirement: always && !f.nullable ? 'required' : 'optional' };
  });
}

const SEVERITY: Record<'missing' | 'type-changed' | 'unexpected-null', Record<FieldRequirement, DriftSeverity>> = {
  missing: { required: 'breaking', optional: 'info', unspecified: 'unknown' },
  'type-changed': { required: 'breaking', optional: 'risk', unspecified: 'risk' },
  'unexpected-null': { required: 'breaking', optional: 'risk', unspecified: 'risk' },
};

/**
 * Compares a response against the contract. Classification follows the
 * configured requirements; when a field has no requirement the finding is
 * reported as `unknown` (insufficient information) instead of guessing.
 */
export function checkContract(fields: ContractField[], actual: unknown, options: { strictAdditions: boolean }): DriftReport {
  const obs = observe(actual);
  const findings: DriftFinding[] = [];
  const contractPaths = new Set(fields.map((f) => f.path));
  /** Paths whose subtree should not be inspected (already reported at a higher level). */
  const blocked: string[] = [];
  const isBlocked = (path: string) => blocked.some((b) => isDescendant(path, b));

  const sorted = [...fields].sort((a, b) => a.path.length - b.path.length);
  for (const field of sorted) {
    if (isBlocked(field.path)) continue;
    const o = obs.get(field.path);
    const parent = field.path === '$' ? null : parentPath(field.path);

    if (field.path.endsWith('[]') && (!o || o.present === 0)) {
      if (obs.get(parent!)?.types.has('array')) {
        findings.push({
          path: field.path,
          kind: 'empty-array',
          severity: 'unknown',
          requirement: field.requirement,
          message: 'Array is empty: item fields could not be verified',
        });
      }
      blocked.push(field.path);
      continue;
    }

    const slots = field.path === '$' ? 1 : (o?.slots ?? (parent ? countObjects(actual, parent) : 0));
    const present = o?.present ?? 0;
    const partial = present > 0;
    // A field already absent in part of the reference is optional by observation,
    // so a partial absence without explicit rules matches what was seen before.
    const observedOptional = field.requirement === 'unspecified' && field.alwaysPresent === false;
    if (slots > 0 && present < slots && !field.path.endsWith('[]') && !(observedOptional && partial)) {
      const requirement = observedOptional ? 'optional' : field.requirement;
      findings.push({
        path: field.path,
        kind: 'missing',
        severity: SEVERITY.missing[requirement],
        requirement: field.requirement,
        message:
          (partial ? `Field missing in ${slots - present} of ${slots} occurrences` : 'Field is missing') +
          (requirement === 'unspecified' ? ' — mark it as required or optional to classify the impact' : ''),
        expected: field.types.join(' | ') || 'any',
        occurrences: slots - present,
      });
      if (!partial) {
        blocked.push(field.path);
        continue;
      }
    }
    if (!o) continue;

    const actualTypes = [...o.types].filter((t) => t !== 'null');
    const unexpected = actualTypes.filter((t) => !field.types.includes(t));
    if (field.types.length > 0 && unexpected.length > 0) {
      findings.push({
        path: field.path,
        kind: 'type-changed',
        severity: SEVERITY['type-changed'][field.requirement],
        requirement: field.requirement,
        message: `Type changed from ${field.types.join(' | ')} to ${actualTypes.join(' | ')}`,
        expected: field.types.join(' | '),
        actual: actualTypes.join(' | '),
      });
      blocked.push(field.path);
      continue;
    }
    if (o.types.has('null') && !field.nullable) {
      const nullCount = valuesAt(actual, field.path).filter((v) => v === null).length;
      findings.push({
        path: field.path,
        kind: 'unexpected-null',
        severity: SEVERITY['unexpected-null'][field.requirement],
        requirement: field.requirement,
        message: `Unexpected null value${nullCount > 1 ? ` (${nullCount} occurrences)` : ''}`,
        expected: field.types.join(' | '),
        actual: 'null',
        occurrences: nullCount,
      });
    }
  }

  // New fields: report only the top-most path of each new subtree.
  const added: string[] = [];
  for (const path of [...obs.keys()].sort((a, b) => a.length - b.length)) {
    if (contractPaths.has(path) || isBlocked(path) || added.some((a) => a === path || isDescendant(path, a))) continue;
    if (!contractPaths.has(parentPath(path))) continue;
    added.push(path);
    findings.push({
      path,
      kind: 'added',
      severity: options.strictAdditions ? 'risk' : 'info',
      requirement: 'n/a',
      message: options.strictAdditions ? 'New field not declared in the contract (strict mode)' : 'New field (additive change)',
      actual: [...obs.get(path)!.types].join(' | '),
    });
  }

  const counts: Record<DriftSeverity, number> = { breaking: 0, risk: 0, info: 0, unknown: 0 };
  for (const f of findings) counts[f.severity]++;
  const verdict: DriftVerdict =
    counts.breaking > 0 ? 'incompatible' : counts.risk > 0 ? 'potentially-incompatible' : counts.unknown > 0 ? 'inconclusive' : 'compatible';
  const order: Record<DriftSeverity, number> = { breaking: 0, risk: 1, unknown: 2, info: 3 };
  findings.sort((a, b) => order[a.severity] - order[b.severity] || a.path.localeCompare(b.path));

  return {
    checkedAt: Date.now(),
    verdict,
    counts,
    findings,
    checkedFields: fields.length,
    unspecifiedFields: fields.filter((f) => f.requirement === 'unspecified').length,
  };
}

/** Report used when the response cannot be parsed as JSON. */
export function notJsonReport(fields: ContractField[], detail: string): DriftReport {
  return {
    checkedAt: Date.now(),
    verdict: 'incompatible',
    counts: { breaking: 1, risk: 0, info: 0, unknown: 0 },
    findings: [{ path: '$', kind: 'not-json', severity: 'breaking', requirement: 'required', message: `Response is not valid JSON: ${detail}` }],
    checkedFields: fields.length,
    unspecifiedFields: fields.filter((f) => f.requirement === 'unspecified').length,
  };
}
