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

describe('demo-feed: scheme', () => {
  it('reads demo/feeds/<name>.csv for a demo feed', async () => {
    const text = await readFeedSource(feed('demo-feed:tienda-demo-uno.csv', true));
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
  it('fetches the URL with a timeout signal and returns the body as UTF-8 text', async () => {
    fetchStub.mockResolvedValueOnce(new Response('id,title\nA,Ñandú\n', { status: 200 }));
    const text = await readFeedSource(feed(`https://feeds.example/f.csv?key=${SECRET_KEY}`));
    expect(text).toBe('id,title\nA,Ñandú\n');
    expect(fetchStub).toHaveBeenCalledTimes(1);
    const [target, init] = fetchStub.mock.calls[0] as [URL, { signal?: AbortSignal }];
    expect(new URL(target).hostname).toBe('feeds.example');
    expect(init.signal).toBeInstanceOf(AbortSignal);
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

  it('refuses a body larger than 50 MiB as fetch_failed', async () => {
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
    await expect(readFeedSource(feed('https://feeds.example/huge.csv'))).rejects.toMatchObject({
      code: 'fetch_failed',
    });
    expect(sent).toBeLessThan(60);
  });
});
