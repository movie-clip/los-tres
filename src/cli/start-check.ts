import { LOCAL_FLAG_REFUSAL_EXIT, localFlagRefusal } from '../config/local-flag';

// The container's `server` verb runs this before it migrates (S12.2, AC 33):
// with the local flag on and SITE_URL not a loopback origin it prints the one
// refusal line on stderr and exits 78, so set -e ends the container before
// migrate, seed or serve. Otherwise it prints nothing and exits 0. It is a
// pre-step, not a verb: `start-check` given to the entrypoint still exits 64.
// No database, no runCli: it opens nothing to close.
const refusal = localFlagRefusal(process.env);
if (refusal !== null) {
  console.error(refusal);
  process.exitCode = LOCAL_FLAG_REFUSAL_EXIT;
}
