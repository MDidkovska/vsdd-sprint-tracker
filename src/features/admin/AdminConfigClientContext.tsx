import { createContext, useContext, type ReactNode } from 'react';
import type { AdminConfigClient } from './adminConfigClient';

/**
 * Dependency-injects the hierarchy/reporting-cycle admin client so the Admin
 * Console never imports a concrete implementation. The composition root chooses
 * the real HTTP client by default and the mock client only under
 * `VITE_AUTH_MODE=mock` — the same seam pattern used for the auth, notification
 * and version clients.
 */
const AdminConfigClientContext = createContext<AdminConfigClient | null>(null);

export function AdminConfigClientProvider({
  client,
  children,
}: {
  client: AdminConfigClient;
  children: ReactNode;
}) {
  return (
    <AdminConfigClientContext.Provider value={client}>
      {children}
    </AdminConfigClientContext.Provider>
  );
}

export function useAdminConfigClient(): AdminConfigClient {
  const client = useContext(AdminConfigClientContext);
  if (!client) {
    throw new Error('useAdminConfigClient must be used within an AdminConfigClientProvider');
  }
  return client;
}
