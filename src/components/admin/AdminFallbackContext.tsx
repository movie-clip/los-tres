'use client';

import { createContext, useContext } from 'react';

/**
 * Finished strings for the one admin screen that renders on the client: the
 * error boundary (src/app/admin/error.tsx), which cannot read configuration or
 * messages. The admin layout fills it on the server.
 */
export type AdminFallbackValue = {
  siteName: string;
  areaLabel: string;
  heading: string;
  body: string;
  retry: string;
};

const AdminFallbackContext = createContext<AdminFallbackValue | null>(null);

export function AdminFallbackProvider({
  value,
  children,
}: {
  value: AdminFallbackValue;
  children: React.ReactNode;
}) {
  return <AdminFallbackContext.Provider value={value}>{children}</AdminFallbackContext.Provider>;
}

/** Null when no provider is above (the layout itself failed). */
export function useAdminFallback(): AdminFallbackValue | null {
  return useContext(AdminFallbackContext);
}
