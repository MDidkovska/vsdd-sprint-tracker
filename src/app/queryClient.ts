import { QueryClient } from '@tanstack/react-query';

// Central TanStack Query client factory. The same query hooks are used with the
// Phase A mock repository and, later, the Phase B HTTP repository — only the
// injected repository changes, not this configuration.
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        refetchOnWindowFocus: false,
        staleTime: 30_000,
      },
      mutations: {
        retry: false,
      },
    },
  });
}
