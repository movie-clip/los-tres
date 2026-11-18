import { DemoMark } from './DemoMark';
import { TextLink } from './TextLink';
import { ValueLine } from './ValueLine';
import styles from './NetworkList.module.css';

/** One network, with every string already translated. */
export type NetworkView = {
  id: number;
  name: string;
  slugLabel: string;
  slug: string;
  demo: boolean;
  editHref: string;
  editLabel: string;
  editName: string;
};

export type NetworkListProps = {
  /** Accessible name of the list, "Redes de afiliación". */
  label: string;
  demoLabel: string;
  networks: NetworkView[];
};

/** The networks, in the order given, one outlined box each. Display strings only. */
export function NetworkList({ label, demoLabel, networks }: NetworkListProps) {
  return (
    <ul className={styles.list} aria-label={label} data-testid="networks-list">
      {networks.map((network) => (
        <li key={network.id} className={styles.box} data-testid={`source-network-${network.id}`}>
          <div className={styles.titleRow}>
            <h3 className={styles.title}>{network.name}</h3>
            {network.demo ? <DemoMark label={demoLabel} /> : null}
          </div>
          <ValueLine label={network.slugLabel} value={network.slug} />
          <div className={styles.links}>
            <TextLink href={network.editHref} label={network.editLabel} ariaLabel={network.editName} />
          </div>
        </li>
      ))}
    </ul>
  );
}
