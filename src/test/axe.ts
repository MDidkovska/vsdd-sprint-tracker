import { axe } from 'jest-axe';

// Shared axe-core configuration for the PoC accessibility gate (task 10.5).
//
// Design §12/§14 set an explicit "axe (WCAG 2.2 AA)" target. axe-core's default
// run mixes in best-practice rules and does NOT include the WCAG 2.2 success
// criteria, so we pin the scan to the WCAG 2.0/2.1/2.2 A and AA tags. The 2.2
// tag adds the new AA criteria (e.g. 2.4.11 Focus Not Obscured, 2.5.8 Target
// Size) on top of the 2.0/2.1 baseline. Size/layout-dependent rules return
// "incomplete" (not "violations") under jsdom, which has no layout engine, so
// they are surfaced by the manual keyboard/visual checks rather than this unit
// scan — see docs/accessibility/poc-ui-checks.md.
const WCAG_22_AA_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

/**
 * Run axe against the WCAG 2.2 AA ruleset over the given container.
 * Use with `expect(await axeWcag22aa(container)).toHaveNoViolations()`.
 */
export function axeWcag22aa(container: Element | string): Promise<unknown> {
  return axe(container, { runOnly: { type: 'tag', values: WCAG_22_AA_TAGS } });
}
