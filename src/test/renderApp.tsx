import type { ReactElement, ReactNode } from 'react';
import { render } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { createQueryClient } from '../app/queryClient';
import { RepositoryProvider } from '../api/RepositoryContext';
import { ToastProvider } from '../components/Toast';
import { SelectionProvider } from '../app/selection';
import { createMockRepository } from '../api/mockRepository';
import type { Repository } from '../api/repository';

/** Wrap a component tree in all app providers with a zero-latency mock repo. */
export function renderWithProviders(
  ui: ReactElement,
  options: { repository?: Repository } = {},
) {
  const repository = options.repository ?? createMockRepository({ latencyMs: 0 });
  const queryClient = createQueryClient();

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <RepositoryProvider repository={repository}>
        <QueryClientProvider client={queryClient}>
          <ToastProvider>
            <SelectionProvider>{children}</SelectionProvider>
          </ToastProvider>
        </QueryClientProvider>
      </RepositoryProvider>
    );
  }

  return { repository, ...render(ui, { wrapper: Wrapper }) };
}
