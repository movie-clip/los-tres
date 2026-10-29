'use client';

import Link from 'next/link';

import { Error as errorMessages, NotFound as notFoundMessages } from '../../../messages/es-ES.json';

import styles from './error.module.css';

/**
 * Any failure rendering a public page is answered here: Spanish copy and a way
 * home, inside the public header and footer the layout already draws. It never
 * renders `error.message` or `digest`: a failed search must not echo the term
 * (a query error carries it) and no server detail reaches a visitor. The props
 * Next passes are deliberately not read.
 *
 * A client boundary cannot call next-intl without a provider, so it reads the
 * three finished strings straight from the message file; named imports keep the
 * rest of the file out of the client bundle.
 */
export default function PublicError() {
  return (
    <main className="page" data-testid="public-error">
      <h1 className={styles.heading}>{errorMessages.heading}</h1>
      <p>{errorMessages.body}</p>
      <p>
        <Link href="/" className={styles.home}>
          {notFoundMessages.backHome}
        </Link>
      </p>
    </main>
  );
}
