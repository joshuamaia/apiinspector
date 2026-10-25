/** Lightweight XML pretty printer (indentation only; content is not altered). */
export function formatXml(xml: string, indent = '  '): string {
  const tokens = xml
    .replace(/>\s+</g, '><')
    .trim()
    .split(/(<[^>]+>)/g)
    .filter((t) => t.trim() !== '');
  let depth = 0;
  const lines: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const isTag = token.startsWith('<');
    if (isTag && /^<\//.test(token)) {
      depth = Math.max(0, depth - 1);
      lines.push(indent.repeat(depth) + token);
    } else if (isTag && /^<[^!?][^>]*[^/]>$|^<[a-zA-Z]>$/.test(token)) {
      // Opening tag: keep `<a>text</a>` on one line.
      const next = tokens[i + 1];
      const after = tokens[i + 2];
      if (next !== undefined && !next.startsWith('<') && after && /^<\//.test(after)) {
        lines.push(indent.repeat(depth) + token + next + after);
        i += 2;
      } else {
        lines.push(indent.repeat(depth) + token);
        depth++;
      }
    } else {
      lines.push(indent.repeat(depth) + token.trim());
    }
  }
  return lines.join('\n');
}

export function isWellFormedXml(xml: string): { valid: boolean; error?: string } {
  if (typeof DOMParser === 'undefined') return { valid: true };
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const error = doc.getElementsByTagName('parsererror')[0];
  return error ? { valid: false, error: (error.textContent ?? 'Invalid XML').split('\n')[0] } : { valid: true };
}
