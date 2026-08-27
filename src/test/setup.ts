import '@testing-library/jest-dom/vitest';
import { afterEach, expect } from 'vitest';
import { cleanup } from '@testing-library/react';
import { toHaveNoViolations } from 'jest-axe';

// Extend expect with jest-axe accessibility matcher for component a11y tests.
expect.extend(toHaveNoViolations);

afterEach(() => {
  cleanup();
});
