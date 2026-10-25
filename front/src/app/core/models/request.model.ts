export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

export const BODY_MODES = ['none', 'json', 'text', 'xml', 'form-urlencoded', 'multipart'] as const;
export type BodyMode = (typeof BODY_MODES)[number];

export const AUTH_TYPES = ['none', 'bearer', 'basic', 'apikey'] as const;
export type AuthType = (typeof AUTH_TYPES)[number];

export interface KeyValue {
  id: string;
  key: string;
  value: string;
  enabled: boolean;
}

export interface FormField extends KeyValue {
  kind: 'text' | 'file';
  fileName?: string;
  contentType?: string;
  /** File content, base64 encoded. */
  base64?: string;
}

export interface AuthConfig {
  type: AuthType;
  token: string;
  username: string;
  password: string;
  key: string;
  value: string;
  addTo: 'header' | 'query';
}

export interface BodyConfig {
  mode: BodyMode;
  raw: string;
  fields: FormField[];
}

export interface RequestSettings {
  /** null = use the BFF default. */
  timeoutMs: number | null;
  followRedirects: boolean;
}

/** Everything needed to execute a request. */
export interface RequestDefinition {
  method: HttpMethod;
  url: string;
  params: KeyValue[];
  headers: KeyValue[];
  auth: AuthConfig;
  body: BodyConfig;
  settings: RequestSettings;
}

export function methodAllowsBody(method: HttpMethod): boolean {
  return method !== 'GET' && method !== 'HEAD';
}
