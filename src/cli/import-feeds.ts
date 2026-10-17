import { getDb } from '../db/client';
import {
  FeedNotRegisteredError,
  formatImportReport,
  importExitCode,
  importFeeds,
} from '../server/importer';
import { runCli } from './shared';

// Imports the approved feeds, or one feed with `--feed <id>`. Prints counts and
// rejected-row codes, never a feed URL. Exit 0 unless a feed failed or the
// named feed is not registered (1); 2 for bad arguments.
void runCli('import-feeds', async () => {
  const args = process.argv.slice(2);
  let feedId: number | undefined;
  if (args.length > 0) {
    if (args.length !== 2 || args[0] !== '--feed' || !/^[1-9]\d{0,8}$/.test(args[1])) {
      console.error('usage: import-feeds [--feed <id>]');
      return 2;
    }
    feedId = Number(args[1]);
  }

  try {
    const report = await importFeeds(getDb(), { feedId });
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
