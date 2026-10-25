const SENSITIVE_PARAM = /(token|key|secret|password|passwd|pwd|auth|signature|sig|session|credential|code|jwt)/i;

/**
 * Produces a log-safe representation of a URL: removes user info and masks
 * the value of query parameters that look like credentials.
 */
export function redactUrl(raw: string | URL, extraSensitive: string[] = []): string {
  let url: URL;
  try {
    url = typeof raw === 'string' ? new URL(raw) : new URL(raw.href);
  } catch {
    return '[invalid url]';
  }
  url.username = '';
  url.password = '';
  const extra = new Set(extraSensitive.map((s) => s.toLowerCase()));
  for (const key of [...new Set(url.searchParams.keys())]) {
    if (SENSITIVE_PARAM.test(key) || extra.has(key.toLowerCase())) {
      url.searchParams.set(key, 'REDACTED');
    }
  }
  return url.href;
}
