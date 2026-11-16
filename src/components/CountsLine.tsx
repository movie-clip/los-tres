import { Fragment } from 'react';

import styles from './CountsLine.module.css';

// Between the parts: a middle dot with a space each side (the character the line already uses before "Página").
const SEPARATOR = ' · ';

export type CountsLineProps = {
  /** Finished text before the parts, for example "Para «filtro»:" on the search page. Omitted: none. */
  prefix?: string | null;
  /** The finished parts, in order, for example ["10 compatibles", "23 sin datos"]. */
  parts: string[];
};

/**
 * The content of a counts line with a selected car: an optional prefix, then the
 * parts joined by " · ". Each part is an inline block, so the line wraps between
 * parts first and breaks inside one only when that part alone is wider than the
 * line. It renders no element of its own: the page's paragraph (which keeps its
 * data-testid) holds it, and the text content is the same as the plain joined string.
 */
export function CountsLine({ prefix = null, parts }: CountsLineProps) {
  return (
    <>
      {prefix === null ? null : `${prefix} `}
      {parts.map((part, index) => (
        // The parts are fixed by position, never reordered.
        <Fragment key={index}>
          {index === 0 ? null : SEPARATOR}
          <span className={styles.part}>{part}</span>
        </Fragment>
      ))}
    </>
  );
}
