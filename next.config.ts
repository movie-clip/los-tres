import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const nextConfig: NextConfig = {
  // Self-contained server for the Docker image (TD-3).
  output: 'standalone',
  // Guardrail 5: no framework fingerprint header needed.
  poweredByHeader: false,
};

export default withNextIntl(nextConfig);
