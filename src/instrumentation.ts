// Next.js calls `register()` once per server instance before it handles a
// request: under `next dev`, `next start` and the standalone `node server.js`,
// never during `next build` (S12.2, D-3, DS-12). The start check refuses to
// start when the local flag is on beside a non-loopback SITE_URL. It lives in a
// Node-only module, loaded only in the Node.js runtime, so no Node API reaches
// an edge bundle.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { refuseLocalFlagOnPublicOrigin } = await import('./instrumentation-node');
    refuseLocalFlagOnPublicOrigin();
  }
}
