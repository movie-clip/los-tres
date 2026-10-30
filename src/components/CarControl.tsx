'use client';

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';

import type { PickerMake } from '@/server/car/picker';

import styles from './CarControl.module.css';
import { clearStoredCar, readStoredCar, storeCar } from './car-storage';
import { CarPickerDialog, type CarDialogStrings } from './CarPickerDialog';

/** The key in `history.state` that asks the next load to focus the car label. */
const FOCUS_KEY = 'carFocus';
const PICKER_PATH = '/mi-coche';

/** Finished strings: the control reads no message file. */
export type CarStrings = {
  /** Car.groupLabel: the accessible name of the row. */
  groupLabel: string;
  /** Car.select: the no-car button. */
  select: string;
  /** Car.selected with the name in a `strong`; null with no car. */
  selected: ReactNode;
  change: string;
  changeLabel: string;
  remove: string;
  removeLabel: string;
  dialog: CarDialogStrings;
};

export type CarControlProps = {
  /** The selected car, or null. No database id: it never reaches the browser. */
  car: { slug: string; makeSlug: string; modelSlug: string; name: string } | null;
  /** The slug-shaped `coche` the server did not recognise, else null. */
  unrecognised: string | null;
  /** The page was opened with a `coche`, valid or not: the stored car is not restored then. */
  cochePresent: boolean;
  options: PickerMake[];
  /** The hrefs without script: the picker page, the picker at the current car, the page without `coche`. */
  links: { select: string; change: string | null; remove: string | null };
  strings: CarStrings;
};

type DialogOpen = { startAtCar: boolean; n: number };

const subscribeNever = () => () => {};

function queryParamName(part: string): string {
  const raw = part.split('=')[0].replace(/\+/g, ' ');
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/** The current page address with `coche` set once, last; every other parameter and the fragment kept. */
function hrefWithCar(slug: string): string {
  const { pathname, search, hash } = window.location;
  const kept = search
    .replace(/^\?/, '')
    .split('&')
    .filter((part) => part !== '' && queryParamName(part) !== 'coche');
  kept.push(`coche=${slug}`);
  return `${pathname}?${kept.join('&')}${hash}`;
}

/**
 * The car control of the public header (S5.7): a group named "Tu coche" with either
 * the "Selecciona tu coche" button, or the car's label with "Cambiar" and "Quitar".
 *
 * Without script the actions are links: to the picker page, and to this page without
 * `coche`. With script the first two become buttons that open the picker dialog; every
 * car change is a full document load, because the shared header is not re-rendered on a
 * soft navigation (a stale car would show). Storage is touched only by the picker (write),
 * "Quitar" (clear) and the unknown-car clear; opening a URL with `coche` never writes it.
 */
export function CarControl({ car, unrecognised, cochePresent, options, links, strings }: CarControlProps) {
  // False on the server and while hydrating, true after: the actions swap from link to button.
  const scripted = useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );
  const [dialog, setDialog] = useState<DialogOpen | null>(null);
  const labelRef = useRef<HTMLSpanElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  // Restore the stored car once on a page opened without `coche`, with no history entry;
  // clear the stored value when it is the very value the server did not recognise.
  useEffect(() => {
    if (window.location.pathname === PICKER_PATH) return;
    if (!cochePresent) {
      // A `coche` already in the address (a proxy that did not run) must not loop.
      if (new URLSearchParams(window.location.search).has('coche')) return;
      const stored = readStoredCar();
      if (stored !== null) window.location.replace(hrefWithCar(stored));
      return;
    }
    if (unrecognised !== null && readStoredCar() === unrecognised) clearStoredCar();
  }, [cochePresent, unrecognised]);

  // After a dialog selection the page reloads: put focus on the car label, once.
  useEffect(() => {
    const state = window.history.state as Record<string, unknown> | null;
    if (state === null || typeof state !== 'object' || !(FOCUS_KEY in state)) return;
    labelRef.current?.focus();
    const rest = { ...state };
    delete rest[FOCUS_KEY];
    window.history.replaceState(rest, '');
  }, []);

  function openDialog(startAtCar: boolean, opener: HTMLElement) {
    openerRef.current = opener;
    setDialog((previous) => ({ startAtCar, n: (previous?.n ?? 0) + 1 }));
  }

  function closeDialog() {
    setDialog(null);
    openerRef.current?.focus();
  }

  function pick(slug: string) {
    storeCar(slug);
    const state = window.history.state as Record<string, unknown> | null;
    window.history.replaceState({ ...state, [FOCUS_KEY]: 'car' }, '', hrefWithCar(slug));
    window.location.reload();
  }

  return (
    <>
      <div
        role="group"
        aria-label={strings.groupLabel}
        className={styles.row}
        data-testid="car-control"
      >
        {car === null ? (
          scripted ? (
            <button
              type="button"
              className={styles.button}
              aria-haspopup="dialog"
              data-testid="car-select"
              onClick={(event) => openDialog(false, event.currentTarget)}
            >
              {strings.select}
            </button>
          ) : (
            <a href={links.select} className={styles.button} data-testid="car-select">
              {strings.select}
            </a>
          )
        ) : (
          <>
            <span ref={labelRef} tabIndex={-1} className={styles.label} data-testid="car-label">
              {strings.selected}
            </span>
            <div className={styles.actions}>
              {scripted ? (
                <button
                  type="button"
                  className={`${styles.button} ${styles.compact}`}
                  aria-haspopup="dialog"
                  aria-label={strings.changeLabel}
                  data-testid="car-change"
                  onClick={(event) => openDialog(true, event.currentTarget)}
                >
                  {strings.change}
                </button>
              ) : (
                <a
                  href={links.change ?? links.select}
                  className={`${styles.button} ${styles.compact}`}
                  aria-label={strings.changeLabel}
                  data-testid="car-change"
                >
                  {strings.change}
                </a>
              )}
              <a
                href={links.remove ?? '/'}
                className={`${styles.button} ${styles.compact}`}
                aria-label={strings.removeLabel}
                data-testid="car-remove"
                onClick={() => clearStoredCar()}
              >
                {strings.remove}
              </a>
            </div>
          </>
        )}
      </div>
      {dialog === null ? null : (
        <CarPickerDialog
          key={dialog.n}
          options={options}
          car={car}
          startAtCar={dialog.startAtCar}
          strings={strings.dialog}
          onClose={closeDialog}
          onPick={pick}
        />
      )}
    </>
  );
}
