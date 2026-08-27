# VSDD Sprint Tracker — Implementation Tasks

Tasks are ordered. Do not begin production persistence before the approved UI behaviour and domain contract are covered by tests.

## Phase 0 — Confirm implementation baseline

- [x] 0.1 Review `requirements.md`, `design.md` and the static prototype with the product owner.
- [ ] 0.2 Confirm enterprise constraints: frontend standard, backend standard, deployment platform, OIDC provider, database, supported browsers and export format. (Partially confirmed: Phase A frontend stack, Chrome/Edge and JSON export are agreed. INCOMPLETE — production hosting, backend platform, OIDC provider and the database vendor are not yet selected and remain Phase B enterprise decisions.)
- [x] 0.3 Record any deviation from the reference stack as an architecture decision.
- [x] 0.4 Confirm whether Visa remains a stream with team `VIS-PMNT` or requires a different hierarchy label. (Confirmed: Visa stream, VIS-PMNT team.)
- [x] 0.5 Confirm reporting dates, timezone and definition of “stale”. (Two-week sprints; UTC storage; Europe/Dublin display; stale = latest earlier submission shown when the current checkpoint has none.)

## Phase 1 — Project foundation

- [x] 1.1 Create the typed frontend project and CI commands for lint, typecheck, unit test and build.
- [x] 1.2 Add the approved PTSB asset and create semantic design tokens from the prototype.
- [x] 1.3 Implement global typography, focus, spacing, colour and reduced-motion rules.
- [ ] 1.4 Add a component preview route or Storybook-equivalent for reusable controls. (Deferred: components are exercised via Testing Library + axe instead of a preview harness.)
- [x] 1.5 Configure test fixtures for all eight initial teams.
- [x] 1.6 Add automated checks that fail on TypeScript, lint, accessibility and unit-test errors.

## Phase 2 — Domain model and validation

- [x] 2.1 Define TypeScript domain types for programme, stream, team, sprint, checkpoint, update, exception, version and audit event.
- [x] 2.2 Implement the update schema with the three independent RAG values.
- [x] 2.3 Implement required validation for the four goals/commitments fields.
- [x] 2.4 Implement numeric validation and derived execution/pass rates.
- [x] 2.5 Implement Amber/Red exception-or-rationale validation.
- [x] 2.6 Implement AI-value conditional validation.
- [x] 2.7 Add unit tests for valid, invalid and boundary-value updates.
- [x] 2.8 Define repository interfaces so the UI does not depend on localStorage or HTTP directly.

## Phase 3 — Reusable UI components

- [x] 3.1 Build accessible Button, Field, Textarea, Select, StatusDot, StatusChip, Toast, Skeleton, EmptyState and ErrorState components.
- [x] 3.2 Build `RagSelector` as a labelled radio group with keyboard support.
- [x] 3.3 Build compact metric input and read-only metric components with tabular numbers.
- [x] 3.4 Build `ExceptionEditor` with add, edit, delete/undo and validation states.
- [x] 3.5 Build a responsive read-only exception table that becomes labelled records on small screens.
- [ ] 3.6 Cover every component’s default, hover, focus, active, disabled, loading, error and success states. (Functional states — disabled, loading/Skeleton, error, empty, success — have unit tests; hover/active/focus are CSS pseudo-states covered by the visual-regression suite. A per-state test matrix for every component is not yet complete.)
- [x] 3.7 Add component accessibility tests.

## Phase 4 — Team Update interface

- [x] 4.1 Implement the application header and roving-tab navigation between the two views.
- [x] 4.2 Implement the update context rail for stream, team, sprint and week.
- [x] 4.3 Implement update completeness from schema/section state.
- [x] 4.4 Implement three RAG selectors.
- [x] 4.5 Implement Business goal, Technical / testing goal, Sprint commitment and Next week commitment fields.
- [x] 4.6 Implement Quality evidence inputs and live derived-rate hints.
- [x] 4.7 Implement Achievements this week.
- [x] 4.8 Implement the four-field AI value sequence.
- [x] 4.9 Implement multi-row Risk / Issue / Blocker editing with definitions visible in context.
- [x] 4.10 Implement Leadership ask with explicit `None` support.
- [x] 4.11 Implement the sticky save/submit action bar and mobile in-flow variant.
- [x] 4.12 Implement submit validation, linked error summary and first-invalid-field focus.
- [x] 4.13 Add loading, empty, save failure, permission denied and closed-window states.
- [x] 4.14 Add Team Update component and end-to-end tests.

## Phase 5 — Prototype data adapter

- [x] 5.1 Implement an in-memory/mock repository using the approved seed hierarchy.
- [x] 5.2 Seed realistic records for Week 1 and Week 2 without presenting them as production data.
- [x] 5.3 Implement debounced draft save with Saving/Saved/Failed states.
- [x] 5.4 Implement mock submit and immutable local version creation.
- [x] 5.5 Keep the adapter contract identical to the planned server repository contract.

## Phase 6 — Leadership View

- [x] 6.1 Implement programme summary counts with reporting-period context.
- [x] 6.2 Implement stream, RAG and update-state filters.
- [x] 6.3 Implement Programme → Stream → Team hierarchy with expansion and selection.
- [x] 6.4 Implement selected Team → Sprint → Week nodes.
- [x] 6.5 Show B/T/R and submission state on every team row.
- [x] 6.6 Implement the detail breadcrumb and version/submission label.
- [x] 6.7 Render the four goals/commitments from the selected update.
- [x] 6.8 Render quality evidence and transparent derived rates.
- [x] 6.9 Render Week trajectory and the four-step AI value sequence.
- [x] 6.10 Render multiple Risk / Issue / Blocker items with impact, owner, due date and decision/support.
- [x] 6.11 Render Leadership ask and a separate leadership decision area.
- [x] 6.12 Implement filtered zero state and reset-filters action.
- [x] 6.13 Implement desktop, tablet and phone master/detail behaviour.
- [x] 6.14 Add hierarchy keyboard and screen-reader tests. (Keyboard selection test + axe scan of the programme view; tree uses semantic buttons with ARIA labels and em-dash "no current evidence" labels for Missing.)
- [x] 6.15 Add Leadership View component and end-to-end tests.

## Phase 7 — API and persistence

- [ ] 7.1 Define OpenAPI 3.1 schemas matching the frontend domain types.
- [ ] 7.2 Define document collections/containers, stable query fields, indexes, partition/shard strategy, schema-version compatibility, retention and immutable audit storage for hierarchy, assignments, checkpoints, drafts, versions, exceptions, decisions and audit events. (Document-oriented, vendor-neutral — no relational migrations.)
- [ ] 7.3 Implement programme hierarchy and reporting-cycle read endpoints.
- [ ] 7.4 Implement team draft read/write with optimistic concurrency revision.
- [ ] 7.5 Implement atomic submit that creates immutable version plus audit event.
- [ ] 7.6 Implement authorised reopen with mandatory reason.
- [ ] 7.7 Implement leadership summary and filtered hierarchy projection.
- [ ] 7.8 Implement version history and field-level comparison data.
- [ ] 7.9 Implement leadership decision endpoints.
- [ ] 7.10 Implement structured export job and download authorisation.
- [ ] 7.11 Add API integration tests including conflicts and rollback.

## Phase 8 — Identity and role-based access

- [ ] 8.1 Integrate the agreed OIDC provider without storing application passwords.
- [ ] 8.2 Map authenticated subjects/groups to programme role assignments.
- [ ] 8.3 Enforce Team Contributor and Team Lead scoping in the API.
- [ ] 8.4 Enforce Programme Leadership, Admin and Auditor permissions.
- [ ] 8.5 Add access-denied and session-expired UX states.
- [ ] 8.6 Add automated negative-authorisation tests for every write and export route.

## Phase 9 — Notifications, history and administration

- [ ] 9.1 Implement deadline reminders for Draft and Missing updates.
- [ ] 9.2 Implement notifications for Red release confidence, Blocker and Leadership ask.
- [ ] 9.3 Add deep links to exact team/sprint/week/version.
- [ ] 9.4 Implement version history and compare UI.
- [ ] 9.5 Implement hierarchy, sprint/checkpoint and assignment administration.
- [ ] 9.6 Archive teams without removing historical records.
- [ ] 9.7 Add admin and audit-role tests.

## Phase 10 — Hardening

- [ ] 10.1 Apply secure cookie/token handling, CSRF controls, CSP and output encoding.
- [ ] 10.2 Verify that logs never contain free-text update content or credentials.
- [ ] 10.3 Add rate limits and export/data-enumeration protections.
- [ ] 10.4 Instrument latency, save failure, submit failure, conflict and notification metrics.
- [ ] 10.5 Load-test current-cycle leadership queries at the expected team count plus growth margin.
- [ ] 10.6 Verify draft recovery after network interruption.
- [ ] 10.7 Run WCAG 2.2 AA automated scans and manual keyboard checks.
- [ ] 10.8 Run visual regression at 1440×1000, 1024×768, 768×1024 and 390×844.
- [ ] 10.9 Verify Chrome and Edge support; record Safari/Firefox decision.
- [ ] 10.10 Complete security review and threat-model actions.

## Phase 11 — Pilot and release

- [ ] 11.1 Import/configure the initial VSDD hierarchy and assignments.
- [ ] 11.2 Pilot with one stream for a complete two-week sprint.
- [ ] 11.3 Compare the application output with the existing weekly deck for completeness and decision usefulness.
- [ ] 11.4 Capture user friction, missing fields and false-confidence risks.
- [ ] 11.5 Resolve pilot findings and obtain product/security/accessibility approval.
- [ ] 11.6 Roll out to all eight teams with an agreed support and ownership model.

## Final acceptance checklist

- [ ] Every Leadership View value traces to a Team Update input or a transparent derived calculation.
- [ ] Business goal, Technical / testing goal, Sprint commitment and Next week commitment are visible in both interfaces.
- [ ] Risk, Issue and Blocker remain distinct and carry impact, owner, due date and decision/support.
- [ ] Draft/Missing/Stale/Reopened are not displayed as submitted evidence.
- [ ] Concurrent editing cannot silently overwrite another user.
- [ ] Submitted versions and audit history are immutable to normal application users.
- [ ] Responsive and keyboard workflows retain all core functions.
