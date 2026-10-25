import { decodeBody, isTextualContentType } from './body-codec.js';
import { parseSetCookie } from './cookies.js';

describe('decodeBody', () => {
  it('detects textual content types', () => {
    expect(isTextualContentType('application/json; charset=utf-8')).toBe(true);
    expect(isTextualContentType('application/hal+json')).toBe(true);
    expect(isTextualContentType('text/html')).toBe(true);
    expect(isTextualContentType('image/png')).toBe(false);
  });

  it('decodes text using the declared charset', () => {
    const latin1 = Buffer.from([0x63, 0x61, 0x66, 0xe9]); // "café" in ISO-8859-1
    expect(decodeBody(latin1, 'text/plain; charset=iso-8859-1', false)).toEqual({ body: 'café', encoding: 'utf8' });
  });

  it('encodes binary content as base64', () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
    expect(decodeBody(png, 'image/png', false)).toEqual({ body: png.toString('base64'), encoding: 'base64' });
  });

  it('sniffs untyped content', () => {
    expect(decodeBody(Buffer.from('hello world'), undefined, false).encoding).toBe('utf8');
    expect(decodeBody(Buffer.from([0, 1, 2, 3, 255]), undefined, false).encoding).toBe('base64');
  });

  it('handles empty bodies', () => {
    expect(decodeBody(Buffer.alloc(0), 'application/json', false)).toEqual({ body: '', encoding: 'utf8' });
  });
});

describe('parseSetCookie', () => {
  it('parses attributes', () => {
    const [cookie] = parseSetCookie(['sid=abc=123; Path=/; Domain=.x.com; Max-Age=60; HttpOnly; Secure; SameSite=Strict']);
    expect(cookie).toEqual({
      name: 'sid',
      value: 'abc=123',
      path: '/',
      domain: '.x.com',
      maxAge: 60,
      httpOnly: true,
      secure: true,
      sameSite: 'Strict',
    });
  });

  it('skips malformed cookies', () => {
    expect(parseSetCookie(['novalue', '=x'])).toEqual([]);
  });
});
