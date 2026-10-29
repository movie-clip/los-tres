'use client';

import { createContext, useContext } from 'react';

/**
 * Finished strings for the one public screen that renders on the client: the
 * error boundary (src/app/(public)/error.tsx), which cannot read configuration
 * or messages. PublicChrome fills it on the server.
 */
export type PublicFallbackValue = {
  heading: string;
  body: string;
  /** The way home: NotFound.backHome. */
  home: string;
};

const PublicFallbackContext = createContext<PublicFallbackValue | null>(null);

export function PublicFallbackProvider({
  value,
  children,
}: {
  value: PublicFallbackValue;
  children: React.ReactNode;
}) {
  return <PublicFallbackContext.Provider value={value}>{children}</PublicFallbackContext.Provider>;
}

/** Null when no provider is above (the chrome itself failed). */
export function usePublicFallback(): PublicFallbackValue | null {
  return useContext(PublicFallbackContext);
}
