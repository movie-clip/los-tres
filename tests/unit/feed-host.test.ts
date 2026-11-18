import { describe, expect, it } from 'vitest';

import { feedHost } from '@/server/admin/feed-host';

// S3.1, AC 23 and 24 (guardrail 5): the one function that turns a stored feed
// address into display text. The host and nothing else, or null.

const SECRET = 'KEY-SENTINEL-5b21';

describe('feedHost: the host and nothing else (AC 23)', () => {
  it.each([
    ['a plain address', 'https://feeds.example/catalogo.csv', 'feeds.example'],
    ['a key in the query', `https://api.example/feed?apikey=${SECRET}`, 'api.example'],
    ['a key in the path', `https://api.example/${SECRET}/feed.xml`, 'api.example'],
    ['a key in the fragment', `https://api.example/feed#${SECRET}`, 'api.example'],
    ['a user name and a password', `https://user:${SECRET}@secure.example/feed.csv`, 'secure.example'],
    ['a user name only', `https://${SECRET}@secure.example/feed.csv`, 'secure.example'],
    ['a port', 'https://feeds.example:8443/feed.csv', 'feeds.example'],
    ['an upper-case host', 'https://FEEDS.Example/Feed.CSV', 'feeds.example'],
    ['an upper-case scheme', 'HTTPS://Feeds.Example/x', 'feeds.example'],
    ['a long sub-domain host', `https://${'a'.repeat(63)}.${'b'.repeat(63)}.example/x`, `${'a'.repeat(63)}.${'b'.repeat(63)}.example`],
    ['an address of the old http scheme (a stored row, never a form value)', 'http://old.example/feed.csv', 'old.example'],
  ])('%s', (_label, stored, host) => {
    expect(feedHost(stored)).toBe(host);
  });

  it('never returns a scheme, port, credential, path, query or key in the host', () => {
    const host = feedHost(`https://user:${SECRET}@Api.Example:9000/path/${SECRET}?token=${SECRET}#${SECRET}`);
    expect(host).toBe('api.example');
    for (const part of ['https', ':', '@', '/', '?', '#', 'user', SECRET, '9000', 'path', 'token']) {
      expect(host, part).not.toContain(part);
    }
  });
});

describe('feedHost: an unreadable value gives null and never the value (AC 24)', () => {
  it.each([
    ['a demo-feed: value', 'demo-feed:feed-uno.csv'],
    ['a bare file name', 'feed-3.csv'],
    ['a relative path', '/feeds/uno.csv'],
    ['an empty string', ''],
    ['only blank space', '   '],
    ['a scheme without a host', 'https://'],
    ['text with a key and no scheme', `apikey=${SECRET}`],
    ['a mailto value', `mailto:${SECRET}@x.example`],
  ])('%s', (_label, stored) => {
    expect(feedHost(stored)).toBeNull();
  });

  it('does not throw for any of them', () => {
    for (const stored of ['', ':', '://', 'https://[', 'https://a b/', '\u0000', 'ht tp://x']) {
      expect(() => feedHost(stored)).not.toThrow();
    }
  });

  it('does not put the input into an exception message', () => {
    // A malformed address makes the URL parser throw; the throw must stay inside.
    expect(() => feedHost(`https://[${SECRET}`)).not.toThrow();
    expect(feedHost(`https://[${SECRET}`)).toBeNull();
  });
});
