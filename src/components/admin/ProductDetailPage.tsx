import { TextLink } from './TextLink';
import styles from './ProductDetailPage.module.css';

export type ProductDetailPageProps = {
  /** The way back to the list exactly as it was left: the page builds it from the list's own query. */
  back: { href: string; label: string };
  /** The product's title. */
  heading: string;
  intro: string;
  /** The product box, then the offers section. */
  children: React.ReactNode;
};

/** The page column of one product: the way back, the title, the one-sentence rule, then the product and its offers. */
export function ProductDetailPage({ back, heading, intro, children }: ProductDetailPageProps) {
  return (
    <main className="page">
      <TextLink href={back.href} label={back.label} testId="product-back" />
      <h1 className={styles.heading}>{heading}</h1>
      <p className={styles.intro}>{intro}</p>
      {children}
    </main>
  );
}
