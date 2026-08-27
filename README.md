# VSDD Sprint Tracker

Phase A implementation of the VSDD weekly testing reporting flow: a typed,
componentised React frontend that reproduces the approved **Team Update** and
**Leadership View** against a **replaceable mock repository**. No backend,
database, or authentication is included in Phase A — those are Phase B and are
kept behind vendor-neutral interfaces.

## Requirements

- Node.js `>= 22.12` (a current LTS; see `.nvmrc` which pins Node `24`).
- npm 10+.

```bash
nvm use          # optional, picks up Node 24 from .nvmrc
npm install
```

## Run locally

```bash
npm run dev      # Vite dev server at http://localhost:4173
```

Then open http://localhost:4173 and use the header tabs to switch between
**Team Update** and **Leadership View**.

The app loads seeded demonstration data for all eight teams (MMM, OAH, GRMB,
O24, Visa) across Sprint 14 Week 1/Week 2, plus a closed Sprint 13 and a planned
Sprint 15. Data lives only in memory for the session; it is demonstration data,
not a shared or production record.

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Start the Vite dev server |
| `npm run build` | Typecheck (`tsc --noEmit`) then build the production bundle |
| `npm run preview` | Serve the production build at http://localhost:4173 |
| `npm run typecheck` | TypeScript type checking only |
| `npm run lint` | ESLint (zero-warning policy) |
| `npm test` | Unit / component / integration tests (Vitest + Testing Library + jest-axe) |
| `npm run test:e2e` | Playwright end-to-end + visual-regression tests (Chromium) |
| `npm run verify` | lint + typecheck + test + build |

### End-to-end and visual tests

Playwright targets Chromium and Edge. Chromium is installed with:

```bash
npx playwright install chromium
npm run test:e2e -- --project=chromium
```

Edge requires Microsoft Edge to be present (`npx playwright install msedge`).

Visual-regression baselines (1440×1000, 1024×768, 768×1024, 390×844) are created
on first run:

```bash
npm run test:e2e -- --project=chromium --update-snapshots
```

## Demonstration triggers (mock only)

Typing these tokens into a goal field or the leadership ask exercises edge cases:

- `#conflict` — the next save simulates a concurrent edit and opens the
  conflict-resolution panel.
- `#failsave` — the next save simulates a transient failure.

The `PTSB-VSDD MMM B` Week 1 draft is also pre-armed to raise a conflict on its
first save, and `O24 Desktop Sunset` is intentionally unassigned to demonstrate
read-only / access-denied handling.

## Project structure

```text
src/
  app/            App shell, tab navigation, selection + query client
  api/            Repository interface, in-memory mock, TanStack Query hooks
  domain/         Types, Zod schemas + validation, derived metrics, filtering
  components/     Reusable accessible UI (Button, Field, RagSelector, …)
  features/
    team-update/  Team Update page + sections
    leadership/   Leadership View page + hierarchy + detail
  styles/         tokens.css (from the prototype) + global.css
tests/e2e/        Playwright specs (flow + visual regression)
reference/prototype/   The approved static prototype (visual source of truth)
```

## Design and visual language

- The approved static prototype is preserved under `reference/prototype/` and
  remains the visual and interaction source of truth.
- Semantic design tokens in `src/styles/tokens.css` are extracted from that
  prototype (OKLCH values; brand hex references retained for exports).
- The three RAG statuses (Business outcome, Test delivery, Release confidence)
  always render a text label alongside colour.

## Specification

Kiro-ready spec files live under:

```text
.kiro/specs/vsdd-sprint-tracker/
  requirements.md
  design.md
  tasks.md
```

Phase A covers spec Phases 1–6. Phase 7+ (API, document store, OIDC/RBAC,
notifications, export service) is not implemented and is documented as
vendor-neutral in `design.md`.
