// Which requests to /go are counted as a click (decision 0009, S1.1).
//
// One pure function owns every rule: the method, the prefetch headers, the
// crawler list and the demo flag. It is the only place in the app that reads
// the user agent: the header is read into a local variable, tested against
// CRAWLER_PATTERNS and dropped. It is never returned, stored, logged or passed
// on (guardrail 5).
//
// Limits, stated on purpose: a bot that is not on the list still counts, a
// missing user agent counts, and the click log is a best-effort count. The
// affiliate network's own report stays the authority for commission.
//
// No server-only import: this unit-tests with no database. No I/O, no console.

export type SkipReason = 'method' | 'prefetch' | 'crawler' | 'demo';

export type CountingInput = {
  method: string;
  headers: Pick<Headers, 'get'>;
  isDemoFeed: boolean;
};

// Our own short list, no dependency. A bare `bot` substring is out (it matches
// CUBOT phones), and so are headless browsers and scripting clients: test
// browsers and scripts are counted as visitors.
export const CRAWLER_PATTERNS: readonly RegExp[] = [
  // generic
  /bot\/|\bbot\b|spider|crawl|slurp/i,
  // search and SEO engines
  /googlebot|google-inspectiontool|adsbot-google|mediapartners-google|bingpreview|msnbot|yandex|baiduspider|duckduckbot|applebot|petalbot|semrush|ahrefs|mj12bot|dotbot|bytespider/i,
  // AI crawlers
  /gptbot|claudebot|ccbot|amazonbot|perplexitybot/i,
  // link-preview fetchers
  /facebookexternalhit|facebot|twitterbot|linkedinbot|slackbot|discordbot|telegrambot|whatsapp|skypeuripreview/i,
  // monitors
  /uptimerobot|pingdom|lighthouse/i,
];

const PREFETCH_PURPOSE = /prefetch|prerender|preview/;

function isPrefetch(headers: Pick<Headers, 'get'>): boolean {
  for (const name of ['purpose', 'sec-purpose']) {
    const value = (headers.get(name) ?? '').trim().toLowerCase();
    if (PREFETCH_PURPOSE.test(value)) return true;
  }
  return false;
}

/** null means: write a click row. Any reason means: redirect, write nothing. */
export function skipReason(input: CountingInput): SkipReason | null {
  if (input.method.toUpperCase() !== 'GET') return 'method';
  if (isPrefetch(input.headers)) return 'prefetch';
  const agent = input.headers.get('user-agent') ?? '';
  if (agent !== '' && CRAWLER_PATTERNS.some((pattern) => pattern.test(agent))) return 'crawler';
  if (input.isDemoFeed) return 'demo';
  return null;
}
