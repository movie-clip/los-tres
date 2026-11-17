import { Fragment } from 'react';

import styles from './CountsLine.module.css';

// After every part but the last: a space and a middle dot (the character the line already uses before
// "Página"), then a plain space. The " ·" sits inside the part it follows, so a line can break only after it.
const SEPARATOR = ' ·';

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
 * line. The " ·" ends the part before it in a nowrap span (D-21), so no line starts
 * with the separator or holds it alone. It renders no element of its own: the page's
 * paragraph (which keeps its data-testid) holds it, and the text content is the same
 * as the plain joined string.
 */
export function CountsLine({ prefix = null, parts }: CountsLineProps) {
  const last = parts.length - 1;
  return (
    <>
      {prefix === null ? null : `${prefix} `}
      {parts.map((part, index) => (
        // The parts are fixed by position, never reordered.
        <Fragment key={index}>
          {index === 0 ? null : ' '}
          <span className={styles.part}>
            {part}
            {index === last ? null : <span className={styles.separator}>{SEPARATOR}</span>}
          </span>
        </Fragment>
      ))}
    </>
  );
}
