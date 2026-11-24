import { mkdirSync, writeFileSync } from 'node:fs';

import { compose, e2eLeftovers, e2eProject } from '../support/e2e-stack';

// Runs once after the whole e2e run (Playwright `globalTeardown`, #363), on a green run, a red test, a
// setup that threw and Ctrl-C: Playwright registers the teardown before it runs the setup. It saves the
// stack's logs, removes the e2e Compose project with its volume and proves nothing is left. The next run's
// setup calls `removeStack` first too, so a run that was killed cannot leave the next one dirty.
// By hand, after a kill: docker compose -p los-tres-e2e down --volumes --remove-orphans

/** Removes every container, network and volume of the e2e project, one-off containers included. Throws when Docker refuses. */
export function removeStack(): void {
  const result = compose(['down', '--volumes', '--remove-orphans', '--timeout', '0'], { timeout: 180_000 });
  if (result.status !== 0) {
    throw new Error(`e2e teardown: removing ${e2eProject()} failed (exit ${result.status ?? 'none'})\n${result.stderr.trim()}`);
  }
}

/** Saves the last 500 lines of every service to test-results/e2e-stack.log (git- and docker-ignored; CI uploads it when the gate fails). */
function saveLogs(): void {
  const result = compose(['logs', '--no-color', '--timestamps', '--tail=500'], { timeout: 120_000 });
  const text = `${result.stdout}${result.stderr}`;
  if (text.trim() === '') return;
  mkdirSync('test-results', { recursive: true });
  writeFileSync('test-results/e2e-stack.log', text);
}

export default function globalTeardown(): void {
  const project = e2eProject();
  saveLogs();
  removeStack();
  const left = e2eLeftovers();
  if (left.containers.length + left.volumes.length + left.networks.length > 0) {
    throw new Error(
      `e2e teardown: ${project} left ${left.containers.length} containers, ${left.volumes.length} volumes, ${left.networks.length} networks`,
    );
  }
}
