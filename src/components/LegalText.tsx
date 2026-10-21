import type { ReactNode } from 'react';

import styles from './LegalText.module.css';

/**
 * The reading column and the element set of the three legal pages. Display
 * only: every string arrives finished, and nothing here reads configuration.
 * The children are the sub-components below, rendered inside the column.
 */
export function LegalText({ children }: { children: ReactNode }) {
  return <div className={styles.column}>{children}</div>;
}

export function LegalTitle({ children }: { children: ReactNode }) {
  return <h1 className={styles.title}>{children}</h1>;
}

export function LegalHeading({ children }: { children: ReactNode }) {
  return <h2 className={styles.heading}>{children}</h2>;
}

export function LegalParagraph({ children }: { children: ReactNode }) {
  return <p className={styles.paragraph}>{children}</p>;
}

export function LegalList({ children }: { children: ReactNode }) {
  return <ul className={styles.list}>{children}</ul>;
}

export function LegalItem({ children }: { children: ReactNode }) {
  return <li className={styles.item}>{children}</li>;
}

/**
 * The translator shape the legal content components need. `getTranslations`
 * (server) and `createTranslator` (tests) both satisfy it, so a content
 * component renders the same in a page and in a unit test.
 */
export type LegalTranslator = {
  (key: string, values?: Record<string, string | number>): string;
  rich(
    key: string,
    values?: Record<string, string | number | ((chunks: ReactNode) => ReactNode)>,
  ): ReactNode;
};

/**
 * The rich tags of the legal messages: `<b>` is the bold lead-in, `<email>` the
 * contact address (a `mailto:` link, same tab), `<aepd>` the regulator's site.
 * Only the text inside a tag is the link: the words around it are not.
 */
export function legalRichTags(contactEmail?: string) {
  return {
    b: (chunks: ReactNode) => <strong>{chunks}</strong>,
    email: (chunks: ReactNode) =>
      contactEmail === undefined ? (
        chunks
      ) : (
        <a className={styles.link} href={`mailto:${contactEmail}`}>
          {chunks}
        </a>
      ),
    aepd: (chunks: ReactNode) => (
      <a className={styles.link} href="https://www.aepd.es">
        {chunks}
      </a>
    ),
  };
}
