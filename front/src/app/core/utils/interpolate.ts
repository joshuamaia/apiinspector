export type Variables = Record<string, unknown>;

const VARIABLE = /\{\{\s*([\w.-]+)\s*\}\}/g;

function stringify(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/** Replaces `{{name}}` with variable values. Unknown variables are left untouched. */
export function interpolate(template: string, vars: Variables): string {
  if (!template || !template.includes('{{')) return template;
  return template.replace(VARIABLE, (match, name: string) => (Object.prototype.hasOwnProperty.call(vars, name) ? stringify(vars[name]) : match));
}

/** Names of variables referenced by a template. */
export function referencedVariables(template: string): string[] {
  return [...new Set([...(template ?? '').matchAll(VARIABLE)].map((m) => m[1]))];
}
