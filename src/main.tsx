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
const authClient =
  import.meta.env.VITE_AUTH_MODE === 'mock' ? createMockAuthClient() : createHttpAuthClient();

createRoot(rootElement).render(
  <StrictMode>
    <AuthProvider client={authClient}>
      <AuthGate>
        <RepositoryProvider repository={repository}>
          <QueryClientProvider client={queryClient}>
            <App />
          </QueryClientProvider>
        </RepositoryProvider>
      </AuthGate>
    </AuthProvider>
  </StrictMode>,
);
