export interface ResponseCookie {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  expires?: string;
  maxAge?: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite?: string;
}

/** Parses `Set-Cookie` header values (one cookie per header value). */
export function parseSetCookie(values: string[]): ResponseCookie[] {
  const cookies: ResponseCookie[] = [];
  for (const header of values) {
    const [pair, ...attributes] = header.split(';');
    const eq = pair.indexOf('=');
    if (eq <= 0) continue;
    const cookie: ResponseCookie = {
      name: pair.slice(0, eq).trim(),
      value: pair.slice(eq + 1).trim(),
      httpOnly: false,
      secure: false,
    };
    for (const attribute of attributes) {
      const [rawKey, ...rest] = attribute.split('=');
      const key = rawKey.trim().toLowerCase();
      const value = rest.join('=').trim();
      if (key === 'domain') cookie.domain = value;
      else if (key === 'path') cookie.path = value;
      else if (key === 'expires') cookie.expires = value;
      else if (key === 'max-age' && /^-?\d+$/.test(value)) cookie.maxAge = Number(value);
      else if (key === 'httponly') cookie.httpOnly = true;
      else if (key === 'secure') cookie.secure = true;
      else if (key === 'samesite') cookie.sameSite = value;
    }
    cookies.push(cookie);
  }
  return cookies;
}
