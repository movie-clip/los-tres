import styles from './SiteFooter.module.css';

export type FooterLink = {
  /** A same-origin path, for example /aviso-legal. */
  href: string;
  /** Link text, already translated. */
  label: string;
};

/**
 * The footer of every page: the legal links and nothing else. Plain anchors
 * (never next/link, so nothing is prefetched); no heading, no paragraph.
 */
export function SiteFooter({ links }: { links: FooterLink[] }) {
  return (
    <footer className={styles.footer}>
      <ul className={styles.list}>
        {links.map((link) => (
          <li key={link.href}>
            <a href={link.href} className={styles.link}>
              {link.label}
            </a>
          </li>
        ))}
      </ul>
    </footer>
  );
}
