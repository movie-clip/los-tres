import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const nextConfig: NextConfig = {
  // Self-contained server for the Docker image (TD-3).
  output: 'standalone',
  // Guardrail 5: no framework fingerprint header needed.
  poweredByHeader: false,
  // Guardrail 5 (S5.4): the dev server must not print a request URL, which holds a
  // search term. The production server prints no access log; a test proves it.
  logging: { incomingRequests: false },
  // The admin area (US-2.1): not indexed, not stored by caches or the back button.
  async headers() {
    const adminHeaders = [
      { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
      { key: 'Cache-Control', value: 'no-store' },
    ];
    return [
      { source: '/admin', headers: adminHeaders },
      { source: '/admin/:path*', headers: adminHeaders },
      // The search term is in the URL: a click to a shop must not carry it in the Referer.
      // The click log keeps only the source path (S5.4).
      { source: '/buscar', headers: [{ key: 'Referrer-Policy', value: 'same-origin' }] },
    ];
  },
};

export default withNextIntl(nextConfig);
