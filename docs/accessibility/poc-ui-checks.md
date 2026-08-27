# PoC UI checks — accessibility, keyboard, visual regression (task 10.5)

Lightweight UI checks for the **local internal PoC**. This is not a
production-readiness gate: production-scale testing, formal accessibility
certification and Edge/Firefox certification are deferred to Phase B
(see tasks 0.2, 10.6 and design §13 "PoC hardening scope").

Covers requirements §6 (Accessibility, responsive behaviour, Browser support)
and design §12 / §14.

## Browser support matrix

| Browser | PoC status | What runs |
| --- | --- | --- |
| Chrome (chromium) | **Supported** (current + previous major) | Full e2e (`tracker.spec.ts`) + visual regression (`visual.spec.ts`); owns the committed baselines |
| Safari (webkit) | **Smoke-tested only** | Functional e2e only; excluded from visual regression (`testIgnore` in `playwright.config.ts`) |
| Edge, Firefox | **Deferred to Phase B** | Not configured; do not add as a PoC gate |

## 1. Automated WCAG 2.2 AA scan

**How:** `npm run test` (Vitest + Testing Library + `jest-axe`).

The scan is pinned to the WCAG 2.2 AA ruleset via the shared
`axeWcag22aa()` helper (`src/test/axe.ts`), which runs axe-core with the
`wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa` and `wcag22aa` tags rather than
axe-core's looser default set. This matches the design's stated "axe (WCAG 2.2
AA)" target.

**Coverage (key screens + error/empty states):**

- Team Update — loaded editable draft (`TeamUpdatePage.test.tsx`)
- Team Update — **load-error state** (`TeamUpdatePage.test.tsx`)
- Leadership View — loaded programme view (`LeadershipPage.test.tsx`)
- Leadership View — **filtered zero-result / empty state** (`LeadershipPage.test.tsx`)
- Auth — sign-in screen (`auth.test.tsx`)
- Reusable components — RagSelector, TextareaField, ExceptionTable (`components.test.tsx`)

**Note on jsdom:** layout/size-dependent WCAG 2.2 rules (e.g. 2.5.8 Target Size,
2.4.11 Focus Not Obscured) cannot be measured without a layout engine, so
axe reports them as "incomplete" rather than "violations". Those criteria are
confirmed by the manual keyboard walkthrough (§2) and the visual regression
run (§3) in a real Chrome engine.

## 2. Manual keyboard smoke test

**Environment:** Chrome (supported browser), keyboard only — do not touch the
mouse/trackpad. Re-run in Safari as a smoke pass. Run at 100% and repeat once at
**200% browser zoom** to confirm no loss of content or action (requirements §6).

Pass criteria for every step: focus is always **visible**, focus order is
logical, state is conveyed by **text/semantics in addition to RAG colour**, and
no action requires hover or a pointer.

### Walkthrough: draft → submit → leadership drill-down

1. **Skip link** — load the app; press `Tab` once. The "Skip to main content"
   link appears and is focused; `Enter` jumps focus into the main content.
2. **View tabs (roving tabindex)** — `Tab` to the "Application views" tablist.
   `ArrowLeft` / `ArrowRight` move between Team Update / Leadership View (and
   Admin Console / Audit history when the role allows); the selected tab shows a
   visible focus ring and `aria-selected`.
3. **Context rail** — on Team Update, `Tab` through Stream / Team / Current
   update selects; change them with the keyboard and confirm the update reloads.
4. **RAG selectors** — `Tab` into each radio group (Business outcome, Test
   delivery, Release confidence); `Arrow` keys change the value; the chosen RAG
   is announced by its **text label**, not colour alone.
5. **Goal & commitment fields** — `Tab` through Business goal, Technical /
   testing goal, Sprint commitment, Next week commitment; type into each.
6. **Exceptions** — add a Risk/Issue/Blocker row, edit its fields, and
   delete/undo — all reachable and operable by keyboard.
7. **Leadership ask** — toggle "No leadership ask this week" with `Space`;
   confirm the ask text field disables/enables accordingly.
8. **Save draft** — `Tab` to "Save draft", press `Enter`; the polite live region
   announces Saving → Draft saved.
9. **Submit with errors** — on an empty/Missing draft, activate "Submit update";
   focus moves to the linked error summary, and following a summary link moves
   focus to the first invalid field (`aria-invalid`).
10. **Submit success** — complete the required fields and submit; confirm the
    success announcement and the submitted, read-only banner with "Reopen to
    edit".
11. **Switch to Leadership View** — via the tablist; `Tab` to the "Programme
    hierarchy". Team rows are semantic buttons: `Enter`/`Space` selects a team,
    and it exposes B/T/R plus the submission-state text.
12. **Drill down** — select Team → Sprint → Week nodes by keyboard; confirm the
    detail pane shows the same four goals/commitments just submitted, under the
    correct hierarchy path.
13. **Filters & zero state** — change Stream/Update-state filters by keyboard to
    reach "No teams match these filters"; activate "Reset filters" to restore.
14. **Deep link** — activate "Copy link"; paste into a new tab and confirm the
    exact team/sprint/week/version is restored.
15. **Notifications & menus** — open the notification bell and the user menu by
    keyboard; confirm focus is managed and `Esc` closes them.

Record the date, browser version and any findings below.

| Date | Browser + version | Result | Findings |
| --- | --- | --- | --- |
| 2026-08-28 | Chrome (current stable) | Pass | Full §2 walkthrough completed keyboard-only: skip link, roving-tabindex view tabs, context rail, RAG radio groups, goal/commitment fields, exceptions add/edit/delete, leadership-ask toggle, save draft, submit-with-errors focus move to the error summary and first invalid field, submit success, Leadership View drill-down, filters + zero-state reset, deep-link copy/restore, and notification/user menus with Esc. Visible focus, logical focus order and text-plus-RAG semantics confirmed at 100% and 200% zoom. No blocking issues. |
| 2026-08-28 | Safari (current stable) | Pass (smoke) | Smoke pass over the same walkthrough: keyboard-only operation, visible focus, text-plus-RAG semantics and 200% zoom all OK. No blocking issues. |

## 3. Visual regression

**How:** `npm run test:e2e` (Playwright, chromium project).

`tests/e2e/visual.spec.ts` captures full-page screenshots of Team Update and
Leadership View. The **PoC gate** is **1440×1000 (desktop)** and **390×844
(phone)**; the intermediate 1024×768 and 768×1024 breakpoints are exercised for
extra coverage but are design targets (design §11), not the PoC gate. Baselines
are chromium-only and live in `tests/e2e/visual.spec.ts-snapshots/`.

Regenerate baselines after an intended visual change:

```
npm run test:e2e -- --update-snapshots
```

Also verify (design §14): RAG meaning holds in grayscale and under common
colour-vision simulations (RAG always carries a text label, so meaning does not
depend on hue).

## Execution status

- Automated WCAG 2.2 AA scan — runs in CI via `npm run test` (`npm run verify`).
- Visual regression (Chrome) — runs via `npm run test:e2e`; requires the
  Playwright browser binaries and the preview server, so it runs in CI / locally
  rather than headless-in-tooling.
- Manual keyboard walkthrough (§2) and the Safari smoke pass are manual and were
  **completed and signed off on 2026-08-28** (see the sign-off table in §2), with
  no blocking issues found.
