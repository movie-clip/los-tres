import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { readFeedSource, SourceError } from '@/server/importer/source';

// Guardrail 2: readFeedSource is the one place that fetches or reads a file,
// and it serves a registered feed row only. Nothing here reaches a network:
// global fetch is replaced in every test.

const SECRET_KEY = 'api-key-sentinel-7c1e';

let fetchStub: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchStub = vi.fn(async () => {
    throw new Error('network is off in tests');
  });
  vi.stubGlobal('fetch', fetchStub);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const feed = (url: string, isDemo = false) => ({ id: 1, url, isDemo });

/** Reads the whole byte stream a source returns, as UTF-8 text. */
async function readText(bytes: AsyncIterable<Uint8Array>): Promise<string> {
  const decoder = new TextDecoder();
  let text = '';
  for await (const chunk of bytes) text += decoder.decode(chunk, { stream: true });
  return text + decoder.decode();
}

describe('demo-feed: scheme', () => {
  it('reads demo/feeds/<name>.csv for a demo feed', async () => {
    const text = await readText(await readFeedSource(feed('demo-feed:tienda-demo-uno.csv', true)));
    expect(text.split(/\r?\n/)[0]).toBe('id,title,brand,part_number,ean,price,currency,url,description,category');
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it('refuses the scheme on a feed that is not a demo feed', async () => {
    await expect(readFeedSource(feed('demo-feed:tienda-demo-uno.csv', false))).rejects.toMatchObject({
      code: 'unsupported_url',
    });
  });

  it.each([
    'demo-feed:../package.json',
    'demo-feed:..%2Fx.csv',
    'demo-feed:sub/x.csv',
    'demo-feed:sub\\x.csv',
    'demo-feed:/etc/passwd',
    'demo-feed:UPPER.csv',
    'demo-feed:notcsv.txt',
    'demo-feed:.csv',
    'demo-feed:',
    'demo-feed:x.csv\0',
  ])('refuses %j as unsupported_url', async (url) => {
    await expect(readFeedSource(feed(url, true))).rejects.toMatchObject({ code: 'unsupported_url' });
  });

  it('reports a missing demo file as fetch_failed', async () => {
    await expect(readFeedSource(feed('demo-feed:no-such-feed.csv', true))).rejects.toMatchObject({
      code: 'fetch_failed',
    });
  });
});

describe('schemes other than https', () => {
  it.each([
    'ftp://shop.example/feed.csv',
    'file:///etc/passwd',
    'http://shop.example/feed.csv',
    'javascript:alert(1)',
    'data:text/csv,id,title',
    'C:\\feeds\\feed.csv',
    '/etc/passwd',
    'feed.csv',
    '',
  ])('refuses %j as unsupported_url without calling fetch', async (url) => {
    await expect(readFeedSource(feed(url, true))).rejects.toMatchObject({ code: 'unsupported_url' });
    expect(fetchStub).not.toHaveBeenCalled();
  });
});

describe('https feeds', () => {
  it('fetches the URL with a timeout signal and manual redirects and returns the body bytes', async () => {
    fetchStub.mockResolvedValueOnce(new Response('id,title\nA,Ñandú\n', { status: 200 }));
    const bytes = await readFeedSource(feed(`https://feeds.example/f.csv?key=${SECRET_KEY}`));
    expect(await readText(bytes)).toBe('id,title\nA,Ñandú\n');
    expect(fetchStub).toHaveBeenCalledTimes(1);
    const [target, init] = fetchStub.mock.calls[0] as [
      URL,
      { signal?: AbortSignal; redirect?: string },
    ];
    expect(new URL(target).hostname).toBe('feeds.example');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.redirect).toBe('manual');
  });

  it('reports a non-2xx answer as fetch_failed', async () => {
    fetchStub.mockResolvedValueOnce(new Response('nope', { status: 503 }));
    await expect(readFeedSource(feed('https://feeds.example/f.csv'))).rejects.toMatchObject({
      code: 'fetch_failed',
    });
  });

  it('reports a network error as fetch_failed and keeps the URL out of the error', async () => {
    fetchStub.mockRejectedValueOnce(
      new Error(`connect ECONNREFUSED https://feeds.example/f.csv?key=${SECRET_KEY}`),
    );
    const error = await readFeedSource(feed(`https://feeds.example/f.csv?key=${SECRET_KEY}`)).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(SourceError);
    expect((error as SourceError).code).toBe('fetch_failed');
    expect(String((error as SourceError).message)).not.toContain(SECRET_KEY);
    expect(String((error as SourceError).stack)).not.toContain(SECRET_KEY);
  });

  it('refuses a body larger than 50 MiB as too_large', async () => {
    const chunk = new Uint8Array(1024 * 1024);
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        sent += 1;
        if (sent > 60) controller.close();
        else controller.enqueue(chunk);
      },
    });
    fetchStub.mockResolvedValueOnce(new Response(body, { status: 200 }));
    await expect(
      readFeedSource(feed('https://feeds.example/huge.csv')).then(readText),
    ).rejects.toMatchObject({ code: 'too_large' });
    expect(sent).toBeLessThan(60);
  });
});

// Redirects (D-3, F-1): `redirect: 'manual'` on every call; a hop is followed
// only to https on the feed URL's own host, at most 5 times. A Location can
// carry an API key, so it never reaches an error or its stack.

const redirect = (location: string | null, status = 302) =>
  new Response(null, { status, headers: location === null ? {} : { location } });

function callTarget(index: number): string {
  return String((fetchStub.mock.calls[index] as [URL])[0]);
}

describe('redirects', () => {
  it('follows a same-host https redirect (absolute, then relative) and reads the final body', async () => {
    fetchStub
      .mockResolvedValueOnce(redirect('https://feeds.example/step2/f.csv'))
      .mockResolvedValueOnce(redirect('/final/f.csv', 301))
      .mockResolvedValueOnce(new Response('id,title\nA,x\n', { status: 200 }));
    const text = await readText(await readFeedSource(feed('https://feeds.example/f.csv')));
    expect(text).toBe('id,title\nA,x\n');
    expect(fetchStub).toHaveBeenCalledTimes(3);
    expect(callTarget(1)).toBe('https://feeds.example/step2/f.csv');
    expect(callTarget(2)).toBe('https://feeds.example/final/f.csv');
    for (const [, init] of fetchStub.mock.calls as [URL, { redirect?: string }][]) {
      expect(init.redirect).toBe('manual');
    }
  });

  it.each([301, 302, 303, 307, 308])('treats %i as a redirect', async (status) => {
    fetchStub
      .mockResolvedValueOnce(redirect('/next', status))
      .mockResolvedValueOnce(new Response('id\n', { status: 200 }));
    await readFeedSource(feed('https://feeds.example/f.csv'));
    expect(fetchStub).toHaveBeenCalledTimes(2);
  });

  it('follows exactly 5 redirects and refuses the 6th as redirect_refused', async () => {
    for (let hop = 0; hop < 5; hop += 1) fetchStub.mockResolvedValueOnce(redirect(`/h${hop}`));
    fetchStub.mockResolvedValueOnce(new Response('id\n', { status: 200 }));
    await readFeedSource(feed('https://feeds.example/f.csv'));
    expect(fetchStub).toHaveBeenCalledTimes(6);

    fetchStub.mockReset();
    for (let hop = 0; hop < 6; hop += 1) fetchStub.mockResolvedValueOnce(redirect(`/h${hop}`));
    fetchStub.mockResolvedValueOnce(new Response('id\n', { status: 200 }));
    await expect(readFeedSource(feed('https://feeds.example/f.csv'))).rejects.toMatchObject({
      code: 'redirect_refused',
    });
    expect(fetchStub).toHaveBeenCalledTimes(6);
  });

  it.each([
    ['plain http', 'http://feeds.example/f.csv'],
    ['another host', 'https://cdn.example/f.csv'],
    ['a subdomain', 'https://dl.feeds.example/f.csv'],
    ['another port', 'https://feeds.example:8443/f.csv'],
    ['another scheme', 'ftp://feeds.example/f.csv'],
    ['a protocol-relative other host', '//cdn.example/f.csv'],
    ['userinfo that changes the host', 'https://feeds.example@cdn.example/f.csv'],
  ])('refuses a redirect to %s as redirect_refused and makes no second request', async (_label, target) => {
    fetchStub.mockResolvedValueOnce(redirect(target));
    await expect(readFeedSource(feed('https://feeds.example/f.csv'))).rejects.toMatchObject({
      code: 'redirect_refused',
    });
    expect(fetchStub).toHaveBeenCalledTimes(1);
  });

  it('refuses a hop to a different host in the middle of a chain', async () => {
    fetchStub
      .mockResolvedValueOnce(redirect('/a'))
      .mockResolvedValueOnce(redirect('https://evil.example/b'));
    await expect(readFeedSource(feed('https://feeds.example/f.csv'))).rejects.toMatchObject({
      code: 'redirect_refused',
    });
    expect(fetchStub).toHaveBeenCalledTimes(2);
  });

  it('compares against the original feed host, not the previous hop', async () => {
    fetchStub.mockResolvedValueOnce(redirect('https://FEEDS.example:443/ok'));
    fetchStub.mockResolvedValueOnce(new Response('id\n', { status: 200 }));
    await readFeedSource(feed('https://feeds.example/f.csv'));
    expect(fetchStub).toHaveBeenCalledTimes(2);
  });

  it('reports a 3xx with no Location as fetch_failed', async () => {
    fetchStub.mockResolvedValueOnce(redirect(null));
    await expect(readFeedSource(feed('https://feeds.example/f.csv'))).rejects.toMatchObject({
      code: 'fetch_failed',
    });
  });

  it('keeps the feed URL and the Location out of the error message and stack', async () => {
    const location = `https://cdn.example/f.csv?key=${SECRET_KEY}`;
    fetchStub.mockResolvedValueOnce(redirect(location));
    const error = await readFeedSource(feed(`https://feeds.example/f.csv?key=${SECRET_KEY}`)).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(SourceError);
    expect((error as SourceError).code).toBe('redirect_refused');
    expect(String((error as SourceError).message)).not.toContain(SECRET_KEY);
    expect(String((error as SourceError).stack)).not.toContain(SECRET_KEY);
    expect(String((error as SourceError).stack)).not.toContain('cdn.example');
  });

  it('cancels the body of a redirect response it does not read', async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      },
    });
    fetchStub
      .mockResolvedValueOnce(new Response(body, { status: 302, headers: { location: '/next' } }))
      .mockResolvedValueOnce(new Response('id\n', { status: 200 }));
    await readFeedSource(feed('https://feeds.example/f.csv'));
    expect(cancelled).toBe(true);
  });
});

describe('demo-feed: file names', () => {
  it.each(['demo-feed:absent.xml', 'demo-feed:absent.csv.gz', 'demo-feed:absent.xml.gz'])(
    'accepts the name %s and reports the missing file as fetch_failed',
    async (url) => {
      await expect(readFeedSource(feed(url, true))).rejects.toMatchObject({ code: 'fetch_failed' });
    },
  );

  it.each(['demo-feed:x.gz', 'demo-feed:x.zip', 'demo-feed:x.csv.gz.gz', 'demo-feed:x.xml.bz2'])(
    'refuses the name %s as unsupported_url',
    async (url) => {
      await expect(readFeedSource(feed(url, true))).rejects.toMatchObject({ code: 'unsupported_url' });
    },
  );
});
