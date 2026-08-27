import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { App } from './app/App';
import { createQueryClient } from './app/queryClient';
import { createMockRepository } from './api/mockRepository';
import { RepositoryProvider } from './api/RepositoryContext';
import './styles/tokens.css';
import './styles/global.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element #root was not found in index.html');
}

const queryClient = createQueryClient();
const repository = createMockRepository();

createRoot(rootElement).render(
  <StrictMode>
    <RepositoryProvider repository={repository}>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </RepositoryProvider>
  </StrictMode>,
);
