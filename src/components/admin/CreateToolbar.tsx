import { LinkButton } from './LinkButton';
import styles from './CreateToolbar.module.css';

export type CreateToolbarProps = {
  /** The group's accessible name, "Añadir tienda o feed". */
  label: string;
  links: { href: string; label: string; testId?: string }[];
};

/** A wrapping row of link buttons under the page summary. */
export function CreateToolbar({ label, links }: CreateToolbarProps) {
  return (
    <div role="group" aria-label={label} className={styles.toolbar} data-testid="create-toolbar">
      {links.map((link) => (
        <LinkButton key={link.href} href={link.href} label={link.label} testId={link.testId} />
      ))}
    </div>
  );
}
