import { createContext, useContext, type ReactNode } from 'react';
import type { Repository } from './repository';

/**
 * Dependency-injects the repository so the UI never imports a concrete
 * implementation. Swapping the mock for the Phase B HTTP repository is a
 * one-line change at the composition root (main.tsx) — no UI change.
 */
const RepositoryContext = createContext<Repository | null>(null);

export function RepositoryProvider({
  repository,
  children,
}: {
  repository: Repository;
  children: ReactNode;
}) {
  return <RepositoryContext.Provider value={repository}>{children}</RepositoryContext.Provider>;
}

export function useRepository(): Repository {
  const repository = useContext(RepositoryContext);
  if (!repository) {
    throw new Error('useRepository must be used within a RepositoryProvider');
  }
  return repository;
}
