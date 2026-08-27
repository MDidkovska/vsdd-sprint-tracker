import { createContext, useContext, type ReactNode } from 'react';
import type { VersionClient } from './versionClient';

/**
 * Dependency-injects the version-history client so the Leadership View never
 * imports a concrete implementation. The composition root chooses the real HTTP
 * client by default and the mock client only under `VITE_AUTH_MODE=mock` — the
 * same seam pattern used for the auth and notification clients.
 */
const VersionClientContext = createContext<VersionClient | null>(null);

export function VersionClientProvider({
  client,
  children,
}: {
  client: VersionClient;
  children: ReactNode;
}) {
  return (
    <VersionClientContext.Provider value={client}>{children}</VersionClientContext.Provider>
  );
}

export function useVersionClient(): VersionClient {
  const client = useContext(VersionClientContext);
  if (!client) {
    throw new Error('useVersionClient must be used within a VersionClientProvider');
  }
  return client;
}
