import { describe, expect, it } from 'vitest';

import { waitForNoSessions } from '../support/global-setup';

// The wait in the global setup before the template is cloned (S3, #337): it
// returns when the template has no session, and throws a named error, not pg's
// own, when it still has one after the last poll. A fake client stands in for
// pg_stat_activity; the step is 1 ms so no test waits.

function clientCounting(counts: string[]) {
  const asked: { text: string; values: string[] }[] = [];
  let index = 0;
  return {
    asked,
    query: async (text: string, values: string[]) => {
      asked.push({ text, values });
      const n = counts[Math.min(index, counts.length - 1)];
      index += 1;
      return { rows: [{ n }] };
    },
  };
}

describe('waitForNoSessions', () => {
  it('returns at once when the database has no session', async () => {
    const client = clientCounting(['0']);
    await expect(waitForNoSessions(client, 'tpl', 5, 1)).resolves.toBeUndefined();
    expect(client.asked).toHaveLength(1);
    expect(client.asked[0].values).toEqual(['tpl']);
  });

  it('keeps polling while a session is there and returns when it ends', async () => {
    const client = clientCounting(['2', '1', '0']);
    await expect(waitForNoSessions(client, 'tpl', 5, 1)).resolves.toBeUndefined();
    expect(client.asked).toHaveLength(3);
  });

  it('throws a named error after the last poll when a session is still there', async () => {
    const client = clientCounting(['1']);
    await expect(waitForNoSessions(client, 'tpl', 4, 1)).rejects.toThrow(
      /test template database still had open sessions after 0\.004 s/,
    );
    expect(client.asked).toHaveLength(4);
  });

  it('names no database and no URL in the error', async () => {
    const client = clientCounting(['1']);
    const error = await waitForNoSessions(client, 'secret_database_name', 1, 1).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toContain('secret_database_name');
    expect((error as Error).message).not.toMatch(/postgres/);
  });
});
