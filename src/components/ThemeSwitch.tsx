'use client';

import { useSyncExternalStore } from 'react';

import { chooseScheme, currentScheme, subscribeScheme } from './theme-storage';
import styles from './ThemeSwitch.module.css';

const darkNow = () => currentScheme() === 'dark';
// The server cannot know the scheme, so its markup carries no pressed state and
// hydration has nothing to mismatch.
const unknownOnServer = () => null;

/**
 * The header's theme switch (#398): one toggle button, its name fixed ("Tema oscuro"),
 * pressed while the dark scheme is on. The root `data-theme` attribute is the only state;
 * a press flips it and remembers the choice in this browser. The button stays hidden by
 * its module until the head script has set the attribute, so with no script it is absent.
 */
export function ThemeSwitch({ label }: { label: string }) {
  const pressed = useSyncExternalStore(subscribeScheme, darkNow, unknownOnServer);
  return (
    <button
      type="button"
      className={styles.switch}
      aria-pressed={pressed ?? undefined}
      onClick={() => chooseScheme(currentScheme() === 'dark' ? 'light' : 'dark')}
    >
      <span className={styles.glyph} aria-hidden="true" />
      <span className={styles.words}>{label}</span>
    </button>
  );
}
