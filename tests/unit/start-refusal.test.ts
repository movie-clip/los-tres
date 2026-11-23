import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LOCAL_FLAG_REFUSAL, LOCAL_FLAG_REFUSAL_EXIT } from '@/config/local-flag';

// S12.2 (decision 0017, D-3), ACs 33 to 36 and 38 at the code level: the two start-time hooks the three start
// paths share. `src/instrumentation.ts` `register()` covers `next dev`, `next start` and `node server.js`;
// `src/cli/start-check.ts` is the container `server` verb's pre-step. Both call the pure `localFlagRefusal`
// (its truth table is local-flag.test.ts); here the HOOKS are called with the process effects spied, so a hook
// that stopped calling the check, or printed a value, or exited with another code, fails. The real start paths
// (a container, a host `next dev`) are tests/e2e/collected-start.spec.ts. No process is exited: process.exit
// is replaced for each case.

const PUBLIC_ORIGINS: [string, string | undefined][] = [
  ['a public https origin', 'https://tienda-publica.example'],
  ['a public http origin', 'http://tienda-publica.example'],
  ['a private-network address', 'http://192.168.1.10:3010'],
  ['a value that is not a URL', 'no es una url'],
  ['a blank value', '   '],
  ['an unset value', undefined],
];

let exit: ReturnType<typeof vi.spyOn>;
let errors: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
  errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  process.exitCode = undefined;
});

const printed = () => errors.mock.calls.map((call: unknown[]) => call.join(' '));

describe('src/instrumentation.ts register() (ACs 34, 35: next dev, next start, node server.js)', () => {
  async function register(): Promise<void> {
    vi.resetModules();
    const { register: hook } = await import('@/instrumentation');
    await hook();
  }

  it.each(PUBLIC_ORIGINS)('with the flag on and %s, prints the one line and exits 78', async (_label, siteUrl) => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    vi.stubEnv('LOCAL_COLLECTED_DATA', 'true');
    vi.stubEnv('SITE_URL', siteUrl);

    await register();

    expect(printed()).toEqual([LOCAL_FLAG_REFUSAL]);
    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(LOCAL_FLAG_REFUSAL_EXIT);
    expect(LOCAL_FLAG_REFUSAL_EXIT).toBe(78);
  });

  it('prints no value of either setting', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    vi.stubEnv('LOCAL_COLLECTED_DATA', ' TRUE ');
    vi.stubEnv('SITE_URL', 'https://valor-secreto.example/ruta?clave=SENTINEL');

    await register();

    expect(printed().join('\n')).not.toMatch(/valor-secreto|SENTINEL|TRUE|true=/);
  });

  it.each([
    ['the flag on and a loopback origin', 'true', 'http://127.0.0.1:3010'],
    ['the flag on and localhost', 'true', 'http://localhost:3000'],
    ['the flag off and a public https origin', 'false', 'https://tienda-publica.example'],
    ['the flag unset and a public https origin', undefined, 'https://tienda-publica.example'],
    ['the flag unset and SITE_URL unset', undefined, undefined],
    ['the flag set to "1" and a public https origin', '1', 'https://tienda-publica.example'],
    ['the flag set to "yes" and a public https origin', 'yes', 'https://tienda-publica.example'],
  ])('starts as today with %s: no line, no exit', async (_label, flag, siteUrl) => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    vi.stubEnv('LOCAL_COLLECTED_DATA', flag);
    vi.stubEnv('SITE_URL', siteUrl);

    await register();

    expect(printed()).toEqual([]);
    expect(exit).not.toHaveBeenCalled();
  });

  it.each(['edge', undefined, ''])('does nothing outside the Node.js runtime (NEXT_RUNTIME %j), so no Node API reaches an edge bundle', async (runtime) => {
    vi.stubEnv('NEXT_RUNTIME', runtime);
    vi.stubEnv('LOCAL_COLLECTED_DATA', 'true');
    vi.stubEnv('SITE_URL', 'https://tienda-publica.example');

    await register();

    expect(printed()).toEqual([]);
    expect(exit).not.toHaveBeenCalled();
  });
});

describe('src/cli/start-check.ts, the container server verb pre-step (AC 33)', () => {
  async function startCheck(): Promise<number | string | undefined> {
    vi.resetModules();
    process.exitCode = undefined;
    await import('@/cli/start-check');
    return process.exitCode;
  }

  it.each(PUBLIC_ORIGINS)('with the flag on and %s, prints the one line on stderr and sets exit code 78', async (_label, siteUrl) => {
    vi.stubEnv('LOCAL_COLLECTED_DATA', 'true');
    vi.stubEnv('SITE_URL', siteUrl);

    expect(await startCheck()).toBe(LOCAL_FLAG_REFUSAL_EXIT);

    expect(printed()).toEqual([LOCAL_FLAG_REFUSAL]);
  });

  it('shows neither value in what it prints', async () => {
    vi.stubEnv('LOCAL_COLLECTED_DATA', 'true');
    vi.stubEnv('SITE_URL', 'https://valor-secreto.example/ruta?clave=SENTINEL');

    await startCheck();

    expect(printed().join('\n')).not.toMatch(/valor-secreto|SENTINEL/);
  });

  it.each([
    ['the flag on and a loopback origin', 'true', 'http://127.0.0.1:3010'],
    ['the flag off and a public https origin', 'false', 'https://tienda-publica.example'],
    ['the flag unset and SITE_URL unset', undefined, undefined],
  ])('prints nothing and leaves the exit code alone with %s', async (_label, flag, siteUrl) => {
    vi.stubEnv('LOCAL_COLLECTED_DATA', flag);
    vi.stubEnv('SITE_URL', siteUrl);

    expect(await startCheck()).toBeUndefined();

    expect(printed()).toEqual([]);
  });
});
