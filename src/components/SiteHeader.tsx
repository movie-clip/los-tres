import Link from 'next/link';

/** The site name arrives as a prop: components never read configuration. */
export function SiteHeader({ siteName }: { siteName: string }) {
  return (
    <header className="site-header">
      <Link href="/" className="site-header__name">
        {siteName}
      </Link>
    </header>
  );
}
