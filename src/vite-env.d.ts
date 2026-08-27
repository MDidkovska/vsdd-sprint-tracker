/// <reference types="vite/client" />

// jest-axe ships its own types via @types; declare a minimal fallback so the
// custom matcher is typed inside our Vitest environment.
import 'vitest';

interface AxeMatchers {
  toHaveNoViolations(): void;
}

declare module 'vitest' {
  // eslint-disable-next-line @typescript-eslint/no-empty-interface
  interface Assertion extends AxeMatchers {}
  // eslint-disable-next-line @typescript-eslint/no-empty-interface
  interface AsymmetricMatchersContaining extends AxeMatchers {}
}
