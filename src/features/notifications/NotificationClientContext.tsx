import { createContext, useContext, type ReactNode } from 'react';
import type { NotificationClient } from './notificationClient';

/**
 * Dependency-injects the notification client so the bell/hooks never import a
 * concrete implementation. The composition root chooses the real HTTP client by
 * default and the mock client only under `VITE_AUTH_MODE=mock` — the same seam
 * pattern used for the auth client.
 */
const NotificationClientContext = createContext<NotificationClient | null>(null);

export function NotificationClientProvider({
  client,
  children,
}: {
  client: NotificationClient;
  children: ReactNode;
}) {
  return (
    <NotificationClientContext.Provider value={client}>
      {children}
    </NotificationClientContext.Provider>
  );
}

export function useNotificationClient(): NotificationClient {
  const client = useContext(NotificationClientContext);
  if (!client) {
    throw new Error('useNotificationClient must be used within a NotificationClientProvider');
  }
  return client;
}
