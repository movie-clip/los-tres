import { readdirSync } from 'node:fs';
import path from 'node:path';

const ROUTE_FILE = /^(page|route)\.(ts|tsx|js|jsx|mdx)$/;

/** Every `page.*` / `route.*` file under `appDir`, as posix paths relative to it. */
export function listRouteFiles(appDir: string): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (ROUTE_FILE.test(entry.name)) {
        found.push(path.relative(appDir, full).split(path.sep).join('/'));
      }
    }
  };
  walk(appDir);
  return found.sort();
}

/** C-5: the first directory under `src/app` declares the route as public or admin. */
export function classifyRoute(relativePath: string): 'public' | 'admin' | 'unclassified' {
  const first = relativePath.split('/')[0];
  if (first === '(public)') return 'public';
  if (first === 'admin') return 'admin';
  return 'unclassified';
}
