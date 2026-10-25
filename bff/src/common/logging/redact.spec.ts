import { redactUrl } from './redact.js';

describe('redactUrl', () => {
  it('masks sensitive query parameters and user info', () => {
    const result = redactUrl('https://u:p@api.test/x?access_token=abc&page=2&apiKey=zzz&password=1');
    expect(result).toBe('https://api.test/x?access_token=REDACTED&page=2&apiKey=REDACTED&password=REDACTED');
  });

  it('masks extra parameter names', () => {
    expect(redactUrl('https://api.test/?q=1&custom=s3cret', ['custom'])).toBe('https://api.test/?q=1&custom=REDACTED');
  });

  it('handles invalid URLs', () => {
    expect(redactUrl('::nope::')).toBe('[invalid url]');
  });
});
