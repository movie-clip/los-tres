import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Self-contained server for the Docker image (TD-3).
  output: 'standalone',
  // Guardrail 5: no framework fingerprint header needed.
  poweredByHeader: false,
};

export default nextConfig;
