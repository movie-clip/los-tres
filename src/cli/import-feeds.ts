import { getDb } from '../db/client';
import {
  FeedNotRegisteredError,
  formatImportReport,
  importExitCode,
  importFeeds,
} from '../server/importer';
import { runCli } from './shared';

// Imports the approved feeds, or one feed with `--feed <id>`. Prints counts and
// rejected-row codes, never a feed URL. `--allow-large-removal`, only after
// `--feed <id>`, lets that feed's import remove offers past the small-import
// guard; it never lifts the empty-import guard (S3.3, D-3). Exit 0 unless a
// feed failed or the named feed is not registered (1); 2 for bad arguments.
const USAGE = 'usage: import-feeds [--feed <id> [--allow-large-removal]]';

void runCli('import-feeds', async () => {
  const args = process.argv.slice(2);
  let feedId: number | undefined;
  let allowLargeRemoval = false;
  if (args.length > 0) {
    const wellFormed =
      (args.length === 2 || (args.length === 3 && args[2] === '--allow-large-removal')) &&
      args[0] === '--feed' &&
      /^[1-9]\d{0,8}$/.test(args[1]);
    if (!wellFormed) {
      console.error(USAGE);
      return 2;
    }
    feedId = Number(args[1]);
    allowLargeRemoval = args.length === 3;
  }

  try {
    const report = await importFeeds(getDb(), { feedId, allowLargeRemoval });
    console.log(formatImportReport(report));
    return importExitCode(report);
  } catch (error) {
    if (error instanceof FeedNotRegisteredError) {
      console.error(`import-feeds: feed ${feedId} is not registered`);
      return 1;
    }
    throw error;
  }
});
