import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { App } from './app/App';
import { createQueryClient } from './app/queryClient';
import { createMockRepository } from './api/mockRepository';
import { RepositoryProvider } from './api/RepositoryContext';
import { AuthProvider } from './auth/AuthProvider';
import { AuthGate } from './features/auth/AuthGate';
import { createHttpAuthClient } from './auth/authClient';
import { createMockAuthClient } from './auth/mockAuthClient';
import { NotificationClientProvider } from './features/notifications/NotificationClientContext';
import {
  createHttpNotificationClient,
  createMockNotificationClient,
} from './features/notifications/notificationClient';
import { VersionClientProvider } from './features/leadership/VersionClientContext';
import { AdminConfigClientProvider } from './features/admin/AdminConfigClientContext';
import {
  createHttpAdminConfigClient,
  createMockAdminConfigClient,
} from './features/admin/adminConfigClient';
import {
  createHttpVersionClient,
  createMockVersionClient,
} from './features/leadership/versionClient';
import './styles/tokens.css';
import './styles/global.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element #root was not found in index.html');
}

const queryClient = createQueryClient();
const repository = createMockRepository();

// Real HTTP authentication is the DEFAULT runtime mode: it drives the Fastify
// backend (login, registration, logout, /me, Pending state, Admin Console) via
// the session cookie (credentials: 'include'), using VITE_API_BASE_URL or the
// Vite `/api` dev proxy. The in-memory mock client is used ONLY when explicitly
// requested with VITE_AUTH_MODE=mock (tests/demo); there is no silent fallback
// to mock when the backend is unavailable.
const useMock = import.meta.env.VITE_AUTH_MODE === 'mock';
const authClient = useMock ? createMockAuthClient() : createHttpAuthClient();

// Notifications use the REAL HTTP endpoints by default (session cookie via
// credentials: 'include', shared API base URL); the mock client is used ONLY
// under VITE_AUTH_MODE=mock. There is no silent fallback to mock data — an
// unreachable backend surfaces an explicit connection error in the bell.
const notificationClient = useMock
  ? createMockNotificationClient(repository)
  : createHttpNotificationClient();

// Version history + comparison (task 9.4) uses the REAL Phase 7 HTTP endpoints
// by default (session cookie via credentials: 'include', shared API base URL);
// the mock client is used ONLY under VITE_AUTH_MODE=mock, with no silent
// fallback — an unreachable backend surfaces an explicit connection error.
const versionClient = useMock
  ? createMockVersionClient(repository)
  : createHttpVersionClient();

// Programme hierarchy / reporting-cycle administration (task 9.5) uses the REAL
// admin HTTP endpoints by default (session cookie via credentials: 'include',
// shared API base URL); the mock client is used ONLY under VITE_AUTH_MODE=mock,
// with no silent fallback -- an unreachable backend surfaces a connection error.
const adminConfigClient = useMock
  ? createMockAdminConfigClient()
  : createHttpAdminConfigClient();

createRoot(rootElement).render(
  <StrictMode>
    <AuthProvider client={authClient}>
      <AuthGate>
        <RepositoryProvider repository={repository}>
          <NotificationClientProvider client={notificationClient}>
            <VersionClientProvider client={versionClient}>
              <AdminConfigClientProvider client={adminConfigClient}>
              <QueryClientProvider client={queryClient}>
                <App />
              </QueryClientProvider>
              </AdminConfigClientProvider>
            </VersionClientProvider>
          </NotificationClientProvider>
        </RepositoryProvider>
      </AuthGate>
    </AuthProvider>
  </StrictMode>,
);
