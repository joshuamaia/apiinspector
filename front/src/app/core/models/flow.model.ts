import type { KeyValue, RequestDefinition } from './request.model';

export type ExpectedType = 'any' | 'string' | 'number' | 'boolean' | 'object' | 'array';

/** Extracts a value from a step response into a flow variable. */
export interface FlowExtraction {
  id: string;
  name: string;
  source: 'body' | 'header' | 'status';
  syntax: 'jsonpath' | 'pointer';
  /** JSONPath (`$.data.token`) or JSON Pointer (`/data/token`); header name when source = header. */
  expression: string;
  expectedType: ExpectedType;
  required: boolean;
}

export interface FlowNode {
  id: string;
  name: string;
  x: number;
  y: number;
  request: RequestDefinition;
  extractions: FlowExtraction[];
  /** e.g. `2xx`, `200`, `200,201`, `200-299`. Empty = any status below 400. */
  expectedStatus: string;
  /** Continue the flow even when this step fails. */
  continueOnError: boolean;
}

export interface FlowEdge {
  id: string;
  from: string;
  to: string;
}

export interface Flow {
  id: string;
  name: string;
  description: string;
  nodes: FlowNode[];
  edges: FlowEdge[];
  /** Initial variables available to every step via `{{name}}`. */
  variables: KeyValue[];
  stopOnError: boolean;
  createdAt: number;
  updatedAt: number;
  demo?: boolean;
}

export type StepStatus = 'pending' | 'running' | 'success' | 'failed' | 'skipped';

export interface FlowStepResult {
  nodeId: string;
  status: StepStatus;
  durationMs?: number;
  httpStatus?: number;
  error?: string;
  resolvedUrl?: string;
  extracted: Record<string, unknown>;
  extractionErrors: string[];
  executionId?: string;
  responsePreview?: string;
}

export interface FlowRun {
  flowId: string;
  startedAt: number;
  finishedAt?: number;
  status: 'running' | 'success' | 'failed' | 'cancelled';
  steps: Record<string, FlowStepResult>;
  variables: Record<string, unknown>;
  /** Node ids in execution order (used to animate the path). */
  path: string[];
}
