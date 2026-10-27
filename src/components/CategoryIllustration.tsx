import styles from './CategoryIllustration.module.css';

/** The leaf category slugs that have a drawing. Narrowing a raw slug to one of these is `toIllustrationKey`. */
export const ILLUSTRATION_KEYS = [
  'aceite-de-motor',
  'filtros-de-aceite',
  'filtros-de-aire',
  'filtros-de-combustible',
  'filtros-de-habitaculo',
] as const;

export type IllustrationKey = (typeof ILLUSTRATION_KEYS)[number];

/** A category slug to its drawing. An unknown or root slug is null (the plain tile), never an error. */
export function toIllustrationKey(slug: string): IllustrationKey | null {
  return (ILLUSTRATION_KEYS as readonly string[]).includes(slug) ? (slug as IllustrationKey) : null;
}

function OilJug() {
  return (
    <>
      <rect className={styles.outline} x="24" y="42" width="52" height="64" rx="9" />
      <rect className={styles.outline} x="38" y="28" width="24" height="14" />
      <rect className={styles.solid} x="35" y="16" width="30" height="12" rx="3" />
      <path className={styles.detail} d="M76 56 H88 a8 8 0 0 1 8 8 V82 a8 8 0 0 1 -8 8 H76" />
      <rect className={styles.outlineThin} x="33" y="58" width="34" height="32" rx="4" />
      <path
        className={styles.solid}
        d="M50 66 C50 66 43 74 43 78 a7 7 0 0 0 14 0 C57 74 50 66 50 66 Z"
      />
    </>
  );
}

function OilFilter() {
  return (
    <>
      <rect className={styles.outline} x="34" y="22" width="52" height="64" rx="10" />
      <path className={styles.detail} d="M34 42 H86" />
      <path className={styles.detail} d="M34 54 H86" />
      <rect className={styles.solid} x="28" y="86" width="64" height="12" rx="3" />
      <rect className={styles.outline} x="50" y="98" width="20" height="8" rx="2" />
    </>
  );
}

function AirFilter() {
  return (
    <>
      <rect className={styles.solid} x="14" y="32" width="92" height="56" rx="7" />
      <rect className={styles.paper} x="24" y="42" width="72" height="36" rx="2" />
      <polyline
        className={styles.detail}
        points="26,76 37,44 49,76 60,44 71,76 83,44 94,76"
      />
    </>
  );
}

function FuelFilter() {
  return (
    <>
      <rect className={styles.outline} x="12" y="53" width="20" height="14" rx="3" />
      <rect className={styles.outline} x="88" y="53" width="20" height="14" rx="3" />
      <rect className={styles.outline} x="30" y="34" width="60" height="52" rx="10" />
      <rect className={styles.solid} x="52" y="34" width="16" height="52" />
    </>
  );
}

function CabinFilter() {
  return (
    <>
      <rect className={styles.outline} x="22" y="16" width="52" height="84" rx="7" />
      <path className={styles.detail} d="M32 32 H64" />
      <path className={styles.detail} d="M32 46 H64" />
      <path className={styles.detail} d="M32 60 H64" />
      <path className={styles.detail} d="M32 74 H64" />
      <circle className={styles.ring} cx="78" cy="84" r="20" />
      <path className={styles.paper} d="M68 92 C68 80 78 74 90 74 C90 86 82 94 68 92 Z" />
      <path className={styles.stem} d="M67 94 L82 80" />
    </>
  );
}

const DRAWINGS: Record<IllustrationKey, () => React.JSX.Element> = {
  'aceite-de-motor': OilJug,
  'filtros-de-aceite': OilFilter,
  'filtros-de-aire': AirFilter,
  'filtros-de-combustible': FuelFilter,
  'filtros-de-habitaculo': CabinFilter,
};

/**
 * A flat category stand-in drawn inline, ink and white only. Decorative: the
 * caller that announces it (the product page) puts the label on its own
 * element. The box that holds it sets the size.
 */
export function CategoryIllustration({ illustration }: { illustration: IllustrationKey }) {
  const Drawing = DRAWINGS[illustration];
  return (
    <svg
      className={styles.svg}
      viewBox="0 0 120 120"
      focusable="false"
      aria-hidden="true"
      data-testid="category-illustration"
    >
      <Drawing />
    </svg>
  );
}
