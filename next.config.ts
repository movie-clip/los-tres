import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const nextConfig: NextConfig = {
  // Self-contained server for the Docker image (TD-3).
  output: 'standalone',
  // Guardrail 5: no framework fingerprint header needed.
  poweredByHeader: false,
  // The admin area (US-2.1): not indexed, not stored by caches or the back button.
  async headers() {
    const adminHeaders = [
      { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
      { key: 'Cache-Control', value: 'no-store' },
    ];
    return [
      { source: '/admin', headers: adminHeaders },
      { source: '/admin/:path*', headers: adminHeaders },
    ];
  },
};

export default withNextIntl(nextConfig);
