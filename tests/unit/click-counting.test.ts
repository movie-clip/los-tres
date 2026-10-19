import { describe, expect, it } from 'vitest';

import { skipReason, type CountingInput } from '@/server/clicks/counting';

// Each counting rule on its own, on an otherwise countable request (GET, a
// browser user agent, a non-demo feed), so one rule never masks another.

const CHROME_WINDOWS =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const SAFARI_IOS =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const FIREFOX_ANDROID = 'Mozilla/5.0 (Android 14; Mobile; rv:131.0) Gecko/131.0 Firefox/131.0';
const CUBOT =
  'Mozilla/5.0 (Linux; Android 13; CUBOT P80) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.6723.58 Mobile Safari/537.36';

function input(
  headers: Record<string, string> = { 'user-agent': CHROME_WINDOWS },
  o: { method?: string; isDemoFeed?: boolean } = {},
): CountingInput {
  const map = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    method: o.method ?? 'GET',
    headers: { get: (name: string) => map.get(name.toLowerCase()) ?? null },
    isDemoFeed: o.isDemoFeed ?? false,
  };
}

describe('skipReason (S1.1 counting rules)', () => {
  it('counts a GET with a browser user agent on a non-demo feed', () => {
    expect(skipReason(input())).toBeNull();
  });

  it.each(['HEAD', 'OPTIONS', 'head', 'options', 'POST'])('does not count %s', (method) => {
    expect(skipReason(input(undefined, { method }))).toBe('method');
  });

  it('counts a lowercase get', () => {
    expect(skipReason(input(undefined, { method: 'get' }))).toBeNull();
  });

  it.each([
    ['Purpose', 'prefetch'],
    ['Sec-Purpose', 'prefetch'],
    ['Sec-Purpose', 'prefetch;prerender'],
    ['Purpose', 'preview'],
    ['Purpose', ' Prefetch '],
  ])('does not count %s: %s', (name, value) => {
    expect(skipReason(input({ 'user-agent': CHROME_WINDOWS, [name]: value }))).toBe('prefetch');
  });

  it('counts a request whose Purpose header names something else', () => {
    expect(skipReason(input({ 'user-agent': CHROME_WINDOWS, Purpose: 'navigate' }))).toBeNull();
  });

  const crawlers: [string, string][] = [
    ['generic bot/', 'Mozilla/5.0 (compatible; ExampleBot/2.1; +https://example.test/bot)'],
    ['generic spider', 'Mozilla/5.0 (compatible; SomeSpider/1.0)'],
    ['generic crawl', 'ExampleCrawler/3.0'],
    ['generic slurp', 'Mozilla/5.0 (compatible; Yahoo! Slurp; http://help.yahoo.com/help/us/ysearch/slurp)'],
    ['googlebot', 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'],
    ['google-inspectiontool', 'Mozilla/5.0 (compatible; Google-InspectionTool/1.0)'],
    ['adsbot-google', 'Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X) (compatible; AdsBot-Google-Mobile; +http://www.google.com/mobile/adsbot.html)'],
    ['mediapartners-google', 'Mediapartners-Google'],
    ['bingpreview', 'Mozilla/5.0 (Windows NT 6.1) AppleWebKit/534+ (KHTML, like Gecko) BingPreview/1.0b'],
    ['msnbot', 'msnbot/2.0b (+http://search.msn.com/msnbot.htm)'],
    ['yandex', 'Mozilla/5.0 (compatible; YandexImages/3.0; +http://yandex.com/bots)'],
    ['baiduspider', 'Mozilla/5.0 (compatible; Baiduspider/2.0; +http://www.baidu.com/search/spider.html)'],
    ['duckduckbot', 'DuckDuckBot/1.1; (+http://duckduckgo.com/duckduckbot.html)'],
    ['applebot', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.1.1 Safari/605.1.15 (Applebot/0.1; +http://www.apple.com/go/applebot)'],
    ['petalbot', 'Mozilla/5.0 (compatible; PetalBot;+https://webmaster.petalsearch.com/site/petalbot)'],
    ['semrush', 'Mozilla/5.0 (compatible; SemrushBot/7~bl; +http://www.semrush.com/bot.html)'],
    ['ahrefs', 'Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)'],
    ['mj12bot', 'Mozilla/5.0 (compatible; MJ12bot/v1.4.8; http://mj12bot.com/)'],
    ['dotbot', 'Mozilla/5.0 (compatible; DotBot/1.2; +https://opensiteexplorer.org/dotbot)'],
    ['bytespider', 'Mozilla/5.0 (Linux; Android 5.0) AppleWebKit/537.36 (KHTML, like Gecko) Mobile Safari/537.36 (compatible; Bytespider; spider-feedback@bytedance.com)'],
    ['gptbot', 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.1; +https://openai.com/gptbot'],
    ['claudebot', 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)'],
    ['ccbot', 'CCBot/2.0 (https://commoncrawl.org/faq/)'],
    ['amazonbot', 'Mozilla/5.0 AppleWebKit/600.2.5 (KHTML, like Gecko) Version/8.0.2 Safari/600.2.5 (Amazonbot/0.1; +https://developer.amazon.com/support/amazonbot)'],
    ['perplexitybot', 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)'],
    ['facebookexternalhit', 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)'],
    ['facebot', 'Facebot'],
    ['twitterbot', 'Twitterbot/1.0'],
    ['linkedinbot', 'LinkedInBot/1.0 (compatible; Mozilla/5.0; Apache-HttpClient +http://www.linkedin.com)'],
    ['slackbot', 'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)'],
    ['discordbot', 'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)'],
    ['telegrambot', 'TelegramBot (like TwitterBot)'],
    ['whatsapp', 'WhatsApp/2.23.20.0 A'],
    ['skypeuripreview', 'Mozilla/5.0 (Windows NT 6.1; WOW64) SkypeUriPreview Preview/0.5'],
    ['uptimerobot', 'Mozilla/5.0+(compatible; UptimeRobot/2.0; http://www.uptimerobot.com/)'],
    ['pingdom', 'Pingdom.com_bot_version_1.4_(http://www.pingdom.com/)'],
    ['lighthouse', 'Mozilla/5.0 (Linux; Android 11) AppleWebKit/537.36 Chrome-Lighthouse'],
  ];

  it.each(crawlers)('does not count the %s family', (_family, agent) => {
    expect(skipReason(input({ 'user-agent': agent }))).toBe('crawler');
  });

  it('matches a crawler user agent whatever its case', () => {
    expect(skipReason(input({ 'user-agent': 'GOOGLEBOT/2.1' }))).toBe('crawler');
  });

  it.each([
    ['Chrome on Windows', CHROME_WINDOWS],
    ['Safari on iOS', SAFARI_IOS],
    ['Firefox on Android', FIREFOX_ANDROID],
    ['a CUBOT phone (the word "bot" inside a brand)', CUBOT],
  ])('counts %s', (_name, agent) => {
    expect(skipReason(input({ 'user-agent': agent }))).toBeNull();
  });

  it('counts headless browsers and scripting clients: test browsers are visitors', () => {
    for (const agent of ['HeadlessChrome/130.0.0.0', 'curl/8.5.0', 'python-requests/2.32', 'Wget/1.21']) {
      expect(skipReason(input({ 'user-agent': agent }))).toBeNull();
    }
  });

  it('counts a request with no user agent, and one with an empty user agent', () => {
    expect(skipReason(input({}))).toBeNull();
    expect(skipReason(input({ 'user-agent': '' }))).toBeNull();
  });

  it('does not count a demo-feed offer, on an otherwise countable request', () => {
    expect(skipReason(input(undefined, { isDemoFeed: true }))).toBe('demo');
  });

  it('counts a non-demo feed', () => {
    expect(skipReason(input(undefined, { isDemoFeed: false }))).toBeNull();
  });
});
