export type JsonType = 'string' | 'number' | 'boolean' | 'object' | 'array' | 'null';
export type FieldRequirement = 'required' | 'optional' | 'unspecified';

/** One field of the reference contract. Array items use `[]` (e.g. `$.items[].id`). */
export interface ContractField {
  path: string;
  /** Non-null types observed in the reference response. */
  types: JsonType[];
  /** Whether null was observed (or explicitly allowed). */
  nullable: boolean;
  /** Whether the field was present in every parent object of the reference (false = observed as optional). */
  alwaysPresent?: boolean;
  requirement: FieldRequirement;
}

export interface ContractBaseline {
  id: string;
  name: string;
  description: string;
  requestId: string | null;
  /** Reference JSON as text. */
  sample: string;
  fields: ContractField[];
  /** When true, fields not present in the contract are reported as a risk. */
  strictAdditions: boolean;
  createdAt: number;
  updatedAt: number;
  demo?: boolean;
}

export type DriftSeverity = 'breaking' | 'risk' | 'info' | 'unknown';
export type DriftKind = 'missing' | 'type-changed' | 'unexpected-null' | 'added' | 'empty-array' | 'not-json';

export interface DriftFinding {
  path: string;
  kind: DriftKind;
  severity: DriftSeverity;
  requirement: FieldRequirement | 'n/a';
  message: string;
  expected?: string;
  actual?: string;
  /** Number of occurrences (array items) affected. */
  occurrences?: number;
}

export type DriftVerdict = 'compatible' | 'potentially-incompatible' | 'incompatible' | 'inconclusive';

export interface DriftReport {
  checkedAt: number;
  verdict: DriftVerdict;
  counts: Record<DriftSeverity, number>;
  findings: DriftFinding[];
  checkedFields: number;
  unspecifiedFields: number;
}
