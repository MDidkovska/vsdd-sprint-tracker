import type { ReactElement, ReactNode } from 'react';
import { render } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { createQueryClient } from '../app/queryClient';
import { RepositoryProvider } from '../api/RepositoryContext';
import { ToastProvider } from '../components/Toast';
import { SelectionProvider } from '../app/selection';
import { createMockRepository } from '../api/mockRepository';
import type { Repository } from '../api/repository';
import { NotificationClientProvider } from '../features/notifications/NotificationClientContext';
import {
  createMockNotificationClient,
  type NotificationClient,
} from '../features/notifications/notificationClient';
import { VersionClientProvider } from '../features/leadership/VersionClientContext';
import {
  createMockVersionClient,
  type VersionClient,
} from '../features/leadership/versionClient';

/** Wrap a component tree in all app providers with a zero-latency mock repo. */
export function renderWithProviders(
  ui: ReactElement,
  options: {
    repository?: Repository;
    notificationClient?: NotificationClient;
    versionClient?: VersionClient;
  } = {},
) {
  const repository = options.repository ?? createMockRepository({ latencyMs: 0 });
  const notificationClient =
    options.notificationClient ?? createMockNotificationClient(repository);
  const versionClient = options.versionClient ?? createMockVersionClient(repository);
  const queryClient = createQueryClient();

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <RepositoryProvider repository={repository}>
        <NotificationClientProvider client={notificationClient}>
          <VersionClientProvider client={versionClient}>
            <QueryClientProvider client={queryClient}>
              <ToastProvider>
                <SelectionProvider>{children}</SelectionProvider>
              </ToastProvider>
            </QueryClientProvider>
          </VersionClientProvider>
        </NotificationClientProvider>
      </RepositoryProvider>
    );
  }

  return { repository, notificationClient, versionClient, ...render(ui, { wrapper: Wrapper }) };
}
