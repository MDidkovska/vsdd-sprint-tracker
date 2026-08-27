// Minimal ambient types for jest-axe (no bundled types in v9).
declare module 'jest-axe' {
  export function axe(html: Element | string, options?: unknown): Promise<unknown>;
  export const toHaveNoViolations: {
    toHaveNoViolations(received: unknown): { pass: boolean; message: () => string };
  };
}
