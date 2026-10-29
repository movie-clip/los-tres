'use client';

import Link from 'next/link';

import { usePublicFallback } from '@/components/PublicFallbackContext';

import styles from './error.module.css';

/**
 * Any failure rendering a public page is answered here: Spanish copy and a way
 * home, inside the public header and footer the layout already draws. It never
 * renders `error.message` or `digest`: a failed search must not echo the term
 * (a query error carries it) and no server detail reaches a visitor. The props
 * Next passes are deliberately not read.
 *
 * A client boundary cannot call next-intl without a provider, so the finished
 * strings come from the context PublicChrome fills on the server (the admin
 * error page works the same way).
 */
export default function PublicError() {
  const fallback = usePublicFallback();
  if (!fallback) return null;
  return (
    <main className="page" data-testid="public-error">
      <h1 className={styles.heading}>{fallback.heading}</h1>
      <p>{fallback.body}</p>
      <p>
        <Link href="/" className={styles.home}>
          {fallback.home}
        </Link>
      </p>
    </main>
  );
}
