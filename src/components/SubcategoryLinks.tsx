import styles from './SubcategoryLinks.module.css';

export type SubcategoryLink = {
  /** A stable React key: the child category slug. Never shown. */
  key: string;
  /** Link target, already built: /categoria/<slug>, with only a recognised coche. */
  href: string;
  /** The category name as displayed. */
  name: string;
};

export type SubcategoryLinksProps = {
  /** Visible label of the group and the nav's accessible name, for example "Ir a una categoría". */
  label: string;
  /** Already filtered and in tree order. The component never sorts. */
  links: SubcategoryLink[];
};

const LABEL_ID = 'subcategory-links-label';

/**
 * The root category page's links to its children: a nav named by its visible
 * label, holding a list of plain anchors (no prefetching). Navigation, not a
 * filter: no selected state, no count. Display strings only. Renders nothing
 * for an empty list.
 */
export function SubcategoryLinks({ label, links }: SubcategoryLinksProps) {
  if (links.length === 0) {
    return null;
  }

  return (
    <nav className={styles.group} aria-labelledby={LABEL_ID} data-testid="subcategory-links">
      <span id={LABEL_ID} className={styles.label}>
        {label}
      </span>
      <ul className={styles.list}>
        {links.map(({ key, href, name }) => (
          <li key={key} className={styles.item}>
            <a href={href} className={styles.link} data-testid="subcategory-link">
              <span className={styles.name}>{name}</span>
              <span className={styles.chevron} aria-hidden="true" />
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
