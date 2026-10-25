const TEXTUAL = /^(text\/|application\/(json|xml|javascript|ecmascript|x-www-form-urlencoded|graphql|x-yaml|yaml|x-ndjson|problem\+json|problem\+xml)|image\/svg\+xml)|\+(json|xml)\b/i;

export function isTextualContentType(contentType: string | undefined): boolean {
  return !!contentType && TEXTUAL.test(contentType.trim());
}

function charsetOf(contentType: string | undefined): string | null {
  const match = /charset\s*=\s*"?([^";\s]+)"?/i.exec(contentType ?? '');
  return match ? match[1].toLowerCase() : null;
}

export interface DecodedBody {
  body: string;
  encoding: 'utf8' | 'base64';
}

/**
 * Decides how to ship the body to the browser. Text is decoded using the
 * declared charset; unknown content types are sniffed (valid UTF-8 without
 * binary control characters is considered text); anything else is base64.
 */
export function decodeBody(buffer: Buffer, contentType: string | undefined, truncated: boolean): DecodedBody {
  if (buffer.length === 0) return { body: '', encoding: 'utf8' };
  const charset = charsetOf(contentType);

  if (isTextualContentType(contentType) || charset) {
    try {
      return { body: new TextDecoder(charset ?? 'utf-8').decode(buffer), encoding: 'utf8' };
    } catch {
      return { body: new TextDecoder('utf-8').decode(buffer), encoding: 'utf8' };
    }
  }

  if (!contentType || /^application\/octet-stream/i.test(contentType)) {
    try {
      // A truncated body may end in the middle of a multi-byte sequence.
      const slice = truncated ? buffer.subarray(0, Math.max(0, buffer.length - 4)) : buffer;
      const text = new TextDecoder('utf-8', { fatal: true }).decode(slice);
      // eslint-disable-next-line no-control-regex
      if (!/[\u0000-\u0008\u000e-\u001f]/.test(text)) {
        return { body: new TextDecoder('utf-8').decode(buffer), encoding: 'utf8' };
      }
    } catch {
      /* binary */
    }
  }
  return { body: buffer.toString('base64'), encoding: 'base64' };
}
