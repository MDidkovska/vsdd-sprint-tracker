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

- [x] 7.1 Define OpenAPI 3.1 schemas matching the frontend domain types.
- [x] 7.2 Define document collections/containers, stable query fields, indexes, partition/shard strategy, schema-version compatibility, retention and immutable audit storage for hierarchy, assignments, checkpoints, drafts, versions, exceptions, decisions and audit events. (Document-oriented, vendor-neutral — no relational migrations.)
- [x] 7.2a Scaffold the local Node.js/TypeScript/Fastify backend and MongoDB document adapter, including Docker Compose, environment example, health/readiness checks and persistence integration tests. Do not implement business API endpoints or authentication.
- [x] 7.3 Implement programme hierarchy and reporting-cycle read endpoints.
- [x] 7.4 Implement team draft read/write with optimistic concurrency revision.
- [x] 7.5 Implement atomic submit that creates immutable version plus audit event.
- [x] 7.6 Implement authorised reopen with mandatory reason.
- [x] 7.7 Implement leadership summary and filtered hierarchy projection.
- [x] 7.8 Implement version history and field-level comparison data.
- [x] 7.9 Implement leadership decision endpoints.
- [x] 7.10 Implement the structured export with programme-level authorisation. For the local PoC this is a SYNCHRONOUS structured JSON snapshot returned in the response body (the agreed export format, task 0.2 / R16.1); it reuses the leadership filtered projection so the export matches the visible population, enforces the programme-permission gate before any programme lookup (anti-enumeration, design.md §13), and appends an append-only `EXPORT_CREATED` security-audit event on success (R15). Asynchronous export jobs and download-artifact storage are explicitly deferred to a future production decision — they are not required by R16 and are out of scope for the PoC.
- [x] 7.11 Add API integration tests including conflicts and rollback.

## Phase 8 — Identity and role-based access (local accounts)

> **Identity approach (decided for the PoC).** Phase 8 implements **local
> account** authentication — self-registration with email + password (Argon2id),
> Admin approval and assignment, and opaque server-side sessions. OIDC / Entra
> ID / Auth0 / Okta / Keycloak are **not** implemented; production enterprise
> identity remains a future decision (task 0.2). Authentication and
> authorisation sit behind small `Authenticator` / `AuthorizationPolicy`
> interfaces so OIDC can replace local authentication later without rewriting the
> business services. Uses the `users`, `assignments`, `sessions` and
> `auditEvents` collections (no separate access-request collection).

- [x] 8.1 Implement local registration, login, logout and secure server sessions. (Argon2id password hashing; random opaque session stored by token hash; HttpOnly/SameSite cookie, Secure outside local dev; rate-limited register/login; `/me` backed by the session; registration/logout/login-failure audit events.)
- [x] 8.2 Implement Admin approval and programme/team/role assignment. (Pending queue via `users?status=PENDING`; approve/reject/assign/modify/suspend; `PENDING` on registration → `ACTIVE` on approval; users can never assign or decide on their own account; approval/rejection/assignment/suspension audit events.)
- [x] 8.3 Enforce Team Contributor and Team Lead scoping in the API. (Contributor/Lead may only act on assigned teams; only Team Lead may submit/reopen; enforced server-side, not by hiding UI.)
- [x] 8.4 Enforce Programme Leadership, Admin and Auditor permissions. (Default-deny; Leadership/Admin/Auditor read scopes; decisions/export gated to Leadership/Admin; admin endpoints gated to Admin; account status re-validated every request.)
- [x] 8.5 Add Registration, Pending Approval, Access Denied and Session Expired UX. (Plus Login and the Admin Console screens: pending users, active users, role/team assignments, suspended users and relevant audit history.)
- [x] 8.6 Add automated negative authentication and authorisation tests for every protected endpoint. (401 unauthenticated / 403 unauthorised for every write, reopen, decision, admin and export endpoint; pending/rejected/suspended denial; privilege-escalation attempts; password/token absence from responses, logs and audit events; bootstrap-admin idempotency.)

### First Admin bootstrap

- [x] 8.7 Provide an interactive `npm run bootstrap-admin` command that securely creates the first Admin account without putting the password in shell history or source control, and is idempotent.

### Phase 8 repairs

- [x] 8.8 Make the frontend use the REAL HTTP auth/admin API by default (session cookie, `credentials: 'include'`, `VITE_API_BASE_URL` / Vite `/api` proxy); mock auth only behind `VITE_AUTH_MODE=mock`; no silent mock fallback — an unreachable backend shows a connection-error state. Add a Mongo-backed integration test proving register → PENDING → approval+assignment → logout/login → ACTIVE with the account, assignment and session persisted through a freshly-reconnected repository.
- [x] 8.9 Replace the session-scoped admin activity log with PERSISTED MongoDB audit history: a read-only `GET /api/v1/audit` (newest-first, paginated, filters for `userId`/`entityId`/`action`, Admin/Auditor only, no password hashes / session tokens / user-authored content). The Admin Console loads it; history survives restart and is visible from any Admin/Auditor session.
- [x] 8.10 Implement an explicit read-only Auditor policy (may read hierarchy, reporting summaries, submitted versions/comparisons and audit history; may not edit/submit/reopen, record decisions, export, or perform any admin/assignment action) with negative tests proving Auditor cannot mutate any resource.
- [x] 8.11 Add a MongoDB TTL index for session expiry (`expiresAt` stored as a BSON `Date`, `expireAfterSeconds: 0`), keeping ISO serialization at the domain/API boundary; expired sessions are rejected immediately even before TTL cleanup runs. Add index and expiry tests.

### Phase 8 RBAC + identity-consistency repair

- [x] 8.12 Programme-scoped principal: `CurrentUser.programmeId` end-to-end (backend, frontend, OpenAPI, mock/test principals), populated from the Assignment in `buildPrincipal`. A Leadership/Admin/Auditor role applies only to the assigned programme; every programme-level check verifies the requested programme id.
- [x] 8.13 Wire the authorisation policy into the REAL services (Hierarchy, Draft, Submit, Reopen, Decision, Summary, Version, Export) — not only the HTTP hook — and remove role-only checks that contradicted the matrix. Cross-programme / cross-team / arbitrary-id reads are refused; negative and positive (Admin decision/export, Auditor read-only) tests added.
- [x] 8.14 Validate admin assignments server-side against real reference data (programme + active teams belonging to it; Contributor/Team-Lead need >=1 team), and make registration/approval/assignment/rejection/suspension/bootstrap atomic with rollback tests (+ `ADMIN_BOOTSTRAPPED` audit).
- [x] 8.15 Role-aware frontend navigation (Team Update / Leadership View / Admin Console / Audit history gated by role; unauthorised views never render) with a shared read-only Audit History component used by both Admin and Auditor — the Auditor view never calls the admin user endpoints.

## Phase 9 — Notifications, history and administration

- [x] 9.1 Implement deadline reminders for Draft and Missing updates. (IN-APP ONLY — no email/Teams/Slack/webhook. A reusable in-app notification foundation persisted behind the vendor-neutral repository (`notifications` collection + contract methods; the frontend mock mirrors the backend service). DUE_SOON = deadline within 24h; OVERDUE = deadline passed while the update is still Draft or Missing; a submitted/reopened update stops reminders. Recipients are ACTIVE Contributors/Team Leads assigned to the team, generated LAZILY and IDEMPOTENTLY on inbox load (no cron/worker) with a stable notification key preventing duplicates. Authenticated list + mark-read (+ mark-all) API with per-recipient RBAC (a caller only ever sees/marks their own; others are NOT_FOUND). Notification bell with unread count + in-app inbox; every reminder deep-links to the exact team/sprint/week via task 9.3. The bell talks to the REAL notification HTTP endpoints by default (session cookie via `credentials: 'include'`, shared API base URL) through a `NotificationClient` seam; the mock client is used ONLY under `VITE_AUTH_MODE=mock`, and an unreachable backend shows an explicit connection-error state with no silent fallback to mock data. OpenAPI updated (Notification/NotificationInbox/NotificationDeepLink schemas + `/notifications` endpoints). Focused backend tests (service + routes, 15) and frontend tests (mock repo + bell, 10) cover due-soon, overdue, submitted suppression, deduplication, read state, recipient isolation and deep links. The 9.2 foundation is in place but 9.2 is NOT implemented.)
- [x] 9.2 Implement notifications for Red release confidence, Blocker and Leadership ask. (IN-APP ONLY, reusing the 9.1 foundation — no email/Teams/Slack/webhook/scheduler and no second notification UI. Three separate types `RELEASE_RED`, `OPEN_BLOCKER` and `LEADERSHIP_ASK` on the same `notifications` store/contract/bell. Generated LAZILY and IDEMPOTENTLY on inbox load via a stable status-alert key (recipient + versionId + alertType), so repeated loads for the same submitted version never duplicate, yet a NEWER submitted version with the same condition raises a distinct unread alert linking to that newer version. Recipients are ACTIVE Leadership/Admin assigned to the programme (Auditor is read-only and receives none; Contributors/Team Leads receive none). Evaluates ONLY the latest submitted version per team in the CURRENT (open) reporting checkpoint: never from Draft/Missing/Reopened cells, closed historical or not-yet-open periods, another programme, or an older team version. Blocker = an unresolved `BLOCKER` (`hasBlocker`); leadership ask excludes "None" (`hasLeadershipAsk`); a version can raise several at once. Every alert deep-links to the exact submitted version (task 9.3): `deepLink.view = leadership` + `versionId`, surfaced by the bell into Leadership View. OpenAPI extended (NotificationType enum + `NotificationDeepLink.versionId`). Focused backend service tests (+15, all three types, combined, dedup, programme isolation, recipient roles, latest-version, closed period, read state, deep link), a Mongo persistence test (+1, RED+blocker+ask persisted/dedup/reconnect/version deep link/read state) and frontend tests (+8 across mock repo + bell) added; the 9.1 deadline tests were re-pointed at a pure editor principal so they still isolate deadline behaviour.)
- [x] 9.3 Add deep links to exact team/sprint/week/version. (Context — view + programme/stream/team/sprint/checkpoint-week + version — is encoded in the URL hash and synced both ways: direct load, refresh and copied links restore it, and History API drives Back/Forward. Invalid/missing targets self-correct (unknown view/week ignored; unknown team falls back to the first visible team; unknown sprint falls back to the current sprint; a stale/invalid version id is dropped and re-derived from the Phase 7 versions contract). Unauthorised views are refused by the existing Phase 8 RBAC and never render. A "Copy link" action shares the exact team/sprint/week/version. Focused tests cover valid, invalid, unauthorised, Back/Forward and version-preserving links.)
- [x] 9.4 Implement version history and compare UI. (READ-ONLY, in the Leadership View detail for the selected team/sprint/checkpoint. Lists submitted versions newest-first with version number, author and timestamp; opens any historical version read-only; and compares any two versions field by field. The comparison groups added/removed/changed values by section — RAG, goals & commitments, quality evidence, achievements, AI value, status notes, Leadership ask — and reconciles exceptions by their stable id (added/removed/modified), never a raw JSON diff; line breaks are preserved via `pre-wrap` and numeric zero is preserved via strict `!==` (0 is never treated as absent). The selected version is preserved/shared through the task 9.3 deep link: the anchor effect now KEEPS a valid opened (possibly historical) version and only defaults/re-derives to the latest when the id is empty or unknown to the versions contract. Uses the existing Phase 7 endpoints (`GET /teams/{id}/updates/{cp}/versions`, `GET /updates/{id}`, `GET /updates/{id}/compare/{otherId}`) through a `VersionClient` seam: the REAL HTTP client is the DEFAULT runtime (session cookie via `credentials: 'include'`, shared `VITE_API_BASE_URL`/`/api` base URL); the mock client — which mirrors the backend guards and computes the diff with a client-side port of the pure `compareVersions` — is used ONLY under `VITE_AUTH_MODE=mock`, with NO silent fallback (an unreachable backend shows an explicit connection-error state). Phase 8 programme/team RBAC is enforced server-side and surfaced as loading, empty, connection-error, 401→session-expired, 403→permission-denied and invalid/deleted-version states. Focused tests added: HTTP-client (6: endpoints, `credentials: 'include'`, connection/401/403/404/400 mapping), pure comparison (6: direction, no-change, zero preservation, line-break preservation, exception-by-id), and UI + RBAC (10: newest-first list, empty, connection-error, permission-denied, open historical read-only, deep-link share, field-level compare, zero preservation, invalid/deleted fallback, no write affordances). The Leadership page was not redesigned and no other Phase 9 tasks were implemented.)
- [x] 9.5 Implement hierarchy, sprint/checkpoint and assignment administration. (Adds a system-level Admin `HierarchyAdminService` that configures the programme hierarchy and reporting cycle without a code deployment: create/update streams and teams — enforcing a unique active team name within a stream (R17.3) and rejecting phantom/cross-programme ids with VALIDATION_FAILED — plus create-sprint that generates exactly two weekly checkpoints (R2.1), set-current (exactly one CURRENT checkpoint, retaining priors, R2.2), close-window and an authorised reopen requiring a reason (R2.3, WINDOW_CLOSED/INVALID_STATE guards). Every change appends an append-only audit event (HIERARCHY_CHANGED/SPRINT_CREATED/CHECKPOINT_CHANGED) carrying stable ids only. The service depends on a narrow port that is a subset of the vendor-neutral `DocumentRepository`, so the MongoDB adapter and test fakes satisfy it; assignment administration reuses the existing Phase 8 `AdminService`. New Admin-only HTTP routes (`POST /admin/streams`, `PUT /admin/streams/{id}`, `POST /admin/teams`, `PUT /admin/teams/{id}`, `POST /admin/sprints`, and `POST /admin/checkpoints/{id}/set-current|close|reopen`) are gated by the existing `/api/v1/admin/**` edge rule AND the service's `assertAdmin`, wired via the optional-dependency pattern in server.ts/index.ts, with matching OpenAPI 3.1 paths/schemas. Frontend adds an `AdminConfigClient` seam (real HTTP client is the DEFAULT — session cookie via `credentials: 'include'`, shared API base URL; mock only under `VITE_AUTH_MODE=mock`, no silent fallback, explicit CONNECTION_ERROR) wired through a context/provider in main.tsx, plus a "Hierarchy & sprints" tab in the Admin Console. Tests: backend service (13) and route (6) covering happy paths, 401/403 default-deny, VALIDATION_FAILED for phantom/cross-programme ids, unique-team-name, exactly-two-checkpoints, single-current, closed-window refusal and reopen-requires-reason; frontend mock-client + panel (9) including the connection-error surface. Full verify green: frontend lint/typecheck/tests/OpenAPI/build and server lint/typecheck/332 tests/build.)
- [x] 9.6 Archive teams without removing historical records.
- [x] 9.7 Add admin and audit-role tests.

## Phase 10 — PoC hardening (local internal proof of concept)

Phase 10 hardens the local internal PoC only. It is not a production-readiness
gate: production-scale load testing, enterprise observability platforms,
Edge/Firefox certification, formal penetration testing and a full enterprise
threat-model/security approval are explicitly deferred to Phase B, alongside the
OIDC, production database and hosting decisions (see task 0.2). Do not treat the
PoC as production-ready.

- [x] 10.1 Secure the local-auth baseline: HttpOnly/SameSite session cookies, `Secure` cookies in production, CSRF protection for state-changing requests, output encoding for user-authored text and a minimal Content-Security-Policy. Preserve plain-HTTP local development (Secure cookies stay off locally).
- [x] 10.2 Ensure logs never contain passwords, session tokens or free-text update content; retain only structured operational metadata (stable ids, event type, status, timing).
- [x] 10.3 Apply minimal abuse protection to login, registration and export: rate limiting plus generic responses that prevent account or programme-data enumeration.
- [x] 10.4 Verify draft recovery after a temporary network interruption, a revision conflict or a failed autosave, with no silent data loss (unsaved content stays available for retry).
- [x] 10.5 Run lightweight UI checks: an automated WCAG 2.2 AA scan, a manual keyboard smoke test, visual regression at 1440×1000 and 390×844, with Chrome as the supported browser and Safari smoke-tested only. (Edge/Firefox certification is deferred to Phase B.)
- [x] 10.6 Produce PoC readiness evidence: a local benchmark for 8 teams plus a 2× growth margin, basic latency and error counters derived from the existing structured logs, and a concise security / residual-risk checklist. (Production-scale load testing, enterprise observability, formal penetration testing and full enterprise threat-model/security approval are deferred to Phase B.)

## Phase 11 — Controlled PoC pilot (all eight VSDD teams)

Phase 11 runs a single **controlled proof-of-concept pilot** across all eight
VSDD teams, in parallel with the existing weekly deck. It is **not** a production
rollout and does not make the PoC production-ready: formal production security
approval, the OIDC / production-database / hosting decisions (task 0.2) and
broader operation remain Phase B. Tasks 11.2–11.6 are **HUMAN EVIDENCE
REQUIRED** — they depend on real pilot evidence from people, a shared multi-user
environment and Leadership, and Kiro must not mark them complete automatically.

- [ ] 11.1 Prepare an idempotent pilot configuration/import with dry-run validation covering all streams, all eight teams, accounts, roles, assignments, and one two-week sprint with Week 1 and Week 2 checkpoints. Dry-run validation reports what would change before any write, and re-running the import must not duplicate or silently overwrite existing records. Teams:
  - MMM: PTSB-VSDD MMM A, PTSB-VSDD MMM B
  - OAH: PTSB-VSDD OAH ILS, PTSB-VSDD OAH Sales
  - GRMB: PTSB-VSDD GRMB
  - O24: PTSB-VSDD O24 App Modernization, PTSB-VSDD O24 Desktop Sunset
  - Visa: VIS-PMNT
- [ ] 11.2 **HUMAN EVIDENCE REQUIRED** — Establish a shared pilot environment accessible to all eight teams. Treat the lack of a shared, multi-user environment as a blocker; single-machine validation must not be described or accepted as a multi-user pilot.
- [ ] 11.3 **HUMAN EVIDENCE REQUIRED** — Run one complete two-week controlled pilot with all eight teams while keeping the existing weekly deck in parallel. Week 1 and Week 2 completion each require real evidence; Kiro must not mark this task complete automatically.
- [ ] 11.4 **HUMAN EVIDENCE REQUIRED** — Compare tracker output with the weekly deck across every stream and collect structured feedback from every team plus Leadership: completeness, decision usefulness, friction, missing fields, discrepancies and false-confidence risks.
- [ ] 11.5 **HUMAN EVIDENCE REQUIRED** — Triage findings, implement only agreed fixes, rerun affected acceptance checks and obtain PoC product/accessibility sign-off. Formal production security approval is deferred to Phase B.
- [ ] 11.6 **HUMAN EVIDENCE REQUIRED** — Produce the steady-state handover and go/no-go evidence: named product owner, admin, support route, reporting cadence, runbook, unresolved risks and a recommendation for broader operation. Actual production rollout remains dependent on an approved hosting decision.

### Pilot success criteria

- 8/8 teams correctly configured and assigned.
- 8/8 teams report both Week 1 and Week 2.
- Complete Leadership roll-up.
- No silent overwrite or evidence-state confusion.
- Risks / Issues / Blockers and commitments remain decision-useful.
- Tracker/deck discrepancies recorded.
- Feedback captured from all teams.
- Named ownership and support model.

## Final acceptance checklist

- [ ] Every Leadership View value traces to a Team Update input or a transparent derived calculation.
- [ ] Business goal, Technical / testing goal, Sprint commitment and Next week commitment are visible in both interfaces.
- [ ] Risk, Issue and Blocker remain distinct and carry impact, owner, due date and decision/support.
- [ ] Draft/Missing/Stale/Reopened are not displayed as submitted evidence.
- [ ] Concurrent editing cannot silently overwrite another user.
- [ ] Submitted versions and audit history are immutable to normal application users.
- [ ] Responsive and keyboard workflows retain all core functions.
