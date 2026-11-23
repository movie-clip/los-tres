import { LOCAL_FLAG_REFUSAL_EXIT, localFlagRefusal } from './config/local-flag';

/**
 * Ends the process with the one refusal line and exit 78 when the local flag is
 * on and SITE_URL is not a loopback origin (ACs 34, 35). Exiting, not throwing:
 * Next wraps and logs a throw from `register()`, and the outcome then differs
 * between dev and start (DS-13). Prints nothing and returns otherwise.
 */
export function refuseLocalFlagOnPublicOrigin(): void {
  const refusal = localFlagRefusal(process.env);
  if (refusal === null) return;
  console.error(refusal);
  process.exit(LOCAL_FLAG_REFUSAL_EXIT);
}
