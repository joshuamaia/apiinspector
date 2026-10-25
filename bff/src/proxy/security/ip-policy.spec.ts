import { IpPolicy } from './ip-policy.js';

describe('IpPolicy', () => {
  const strict = new IpPolicy(false);
  const permissive = new IpPolicy(true);

  it.each([
    '127.0.0.1',
    '127.1.2.3',
    '10.0.0.1',
    '172.16.5.4',
    '192.168.1.1',
    '169.254.10.10',
    '100.64.0.1',
    '0.0.0.0',
    '255.255.255.255',
    '224.0.0.1',
    '::1',
    '::',
    'fe80::1',
    'fc00::1',
    'fd12:3456::1',
    '::ffff:127.0.0.1',
    '::ffff:10.0.0.1',
    '64:ff9b::a00:1',
    '2002:7f00:1::',
  ])('blocks non-public address %s', (address) => {
    expect(strict.isAllowed(address)).toBe(false);
  });

  it.each(['8.8.8.8', '1.1.1.1', '93.184.216.34', '2606:4700:4700::1111', '::ffff:8.8.8.8'])('allows public address %s', (address) => {
    expect(strict.isAllowed(address)).toBe(true);
  });

  it('normalizes IPv4-mapped IPv6 addresses', () => {
    expect(strict.evaluate('::ffff:7f00:1')).toMatchObject({ allowed: false, address: '127.0.0.1', range: 'loopback' });
  });

  it('rejects invalid input', () => {
    expect(strict.evaluate('not-an-ip')).toMatchObject({ allowed: false, range: 'invalid' });
    expect(strict.evaluate('fe80::1%eth0').allowed).toBe(false);
  });

  it('allows private ranges only when explicitly enabled', () => {
    expect(permissive.isAllowed('127.0.0.1')).toBe(true);
    expect(permissive.isAllowed('192.168.0.10')).toBe(true);
    expect(permissive.isAllowed('::1')).toBe(true);
  });

  it.each(['169.254.169.254', '169.254.170.2', '100.100.100.200', 'fd00:ec2::254', '::ffff:169.254.169.254'])(
    'always blocks cloud metadata endpoint %s',
    (address) => {
      expect(permissive.evaluate(address)).toMatchObject({ allowed: false, range: 'cloudMetadata' });
    },
  );
});
