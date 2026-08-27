# VSDD Sprint Tracker — Technical and UX Design

## 1. Design intent

The product has one domain model and two task-focused interfaces:

- **Team Update** optimises structured weekly authoring, validation and submission.
- **Leadership View** optimises programme scanning, exception discovery and drill-down.

Leadership View is a projection of submitted Team Update data. It does not maintain a second copy of status content.

## 2. Reference implementation stack

Use this stack for the first implementation unless the target PTSB platform mandates an equivalent:

- Frontend: React + TypeScript + Vite
- Routing/data: React Router and TanStack Query
- Forms: React Hook Form with Zod schemas
- UI styling: CSS Modules or a project token layer; do not introduce a visually opinionated component library that changes the approved design
- API: REST/JSON with an OpenAPI 3.1 contract
- Backend reference: Node.js + TypeScript + Fastify/NestJS, or an equivalent supported enterprise service framework
- Database: **not selected in Phase A.** Phase A uses only the replaceable mock repository and adds no database dependency. Phase B persistence is designed to be database-agnostic with a preferred document-oriented (NoSQL) model. Vendor selection is deferred until enterprise platform constraints are known; likely candidates include Azure Cosmos DB or MongoDB. See §4a for the document aggregate and schema-version strategy.
- Authentication (PoC): **local accounts** — email + password (Argon2id) with
  Admin approval and opaque server-side sessions. It lives behind a small
  authentication interface so enterprise OIDC (which would instead supply a
  stable subject ID and group/role claims) can replace it later without
  rewriting business services. Enterprise OIDC is a future decision (task 0.2).
- Testing: Vitest, Testing Library, Playwright and API integration tests
- Observability (PoC): structured application logs (stable ids, event type, status, timing) with basic latency and error counters derived from those logs, and never any password, session token or free-text status content. An enterprise observability platform is a Phase B decision.

The current static prototype is a UX reference and a functional local adapter. Do not port its localStorage persistence into production.

## 3. System context

```mermaid
flowchart LR
  Contributor[Team Contributor / Lead] --> Web[Web application]
  Leadership[Programme Leadership] --> Web
  Admin[Programme Admin] --> Web
  Web --> API[Tracker API]
  API --> IDP[Enterprise OIDC]
  API --> DB[(Document store — vendor deferred)]
  API --> Notify[Notification adapter]
  API --> Export[Export service]
  API --> Audit[(Append-only audit log)]
```

## 4. Domain model

### Core entities

```text
Programme
  id, name, active

Stream
  id, programmeId, name, sortOrder, active

Team
  id, streamId, name, sortOrder, active, archivedAt?

Sprint
  id, programmeId, label, startDate, endDate, status

ReportingCheckpoint
  id, sprintId, weekNumber(1|2), opensAt, dueAt, closesAt, status

UserAccount                        // `users` collection (local-auth PoC)
  id, email(unique, lowercased), displayName
  passwordHash(Argon2id, never exposed)
  status(PENDING|ACTIVE|REJECTED|SUSPENDED)
  requestedTeam?(free text from registration), createdAt, updatedAt

Assignment                         // `assignments` collection (one per user)
  id(=userId), userId, programmeId?
  teamIds[]                        // teams the user may access
  roles[](CONTRIBUTOR|TEAM_LEAD|LEADERSHIP|ADMIN|AUDITOR)
  updatedAt

Session                            // `sessions` collection (opaque, server-side)
  id(=sha256(token)), userId, createdAt, expiresAt
  // the raw random token is sent ONLY in an HttpOnly SameSite cookie;
  // it is never stored — only its hash — and never logged

TeamAssignment                     // legacy per-team shape (superseded by Assignment)
  id, teamId, userSubject, role, validFrom, validTo?

UpdateDraft
  id, teamId, checkpointId, revision, status, updatedBy, updatedAt
  ragBusiness, ragDelivery, ragRelease
  businessGoal, technicalGoal, sprintCommitment, nextWeekCommitment
  planned, executed, passed, openCritical, blocked, automationPercent
  achievements
  aiUseCase, aiBenefit, aiValidation, aiNext
  leadershipAsk

ExceptionItem
  id, updateDraftId/updateVersionId, type(RISK|ISSUE|BLOCKER)
  impact, ownerSubject/displayName, dueDate, decisionSupport
  status(OPEN|RESOLVED), resolvedAt?, resolutionNote?

UpdateVersion
  id, teamId, checkpointId, versionNumber, submittedBy, submittedAt
  immutable snapshot of UpdateDraft + exception items

LeadershipDecision
  id, updateVersionId, decision, ownerSubject, dueDate?, status, createdAt

AuditEvent
  id, programmeId, aggregateId, entityType, entityId, action, actorSubject
  timestamp, previousVersion?, newVersion?, reason?, filterSummary?, correlationId
  // update actions:  DRAFT_SAVED | SUBMITTED | REOPENED | DECISION_RECORDED | EXPORT_CREATED
  // account actions: USER_REGISTERED | USER_APPROVED | USER_REJECTED
  //                  ASSIGNMENT_CHANGED | USER_SUSPENDED | LOGIN_FAILED | LOGOUT
  //                  ADMIN_BOOTSTRAPPED
  // account events store only stable ids + action; never a password, session
  // token or user-authored status content
```

### Key invariants

- At most one mutable draft exists for a team/checkpoint.
- A submitted `UpdateVersion` is immutable.
- Reopening copies the latest submitted version into a new draft and requires an audit reason.
- Leadership detail reads a specific `UpdateVersion`; draft preview is labelled and permission-scoped.
- Derived execution and pass rates are calculated, never stored as independently editable truth.
- Team archival never removes prior versions.

## 4a. Persistence model (document-oriented, vendor-neutral)

Phase A adds **no database dependency**; it uses only the replaceable mock repository. The following describes the Phase B design so that repository interfaces built now stay forward-compatible. No relational schema or migration tooling is mandated.

### Aggregate

Each team/checkpoint update is a single versioned JSON **document**. A document has a stable *query envelope* and a flexible *payload*.

```jsonc
{
  // --- stable query envelope (always present, indexable, never buried in payload) ---
  "id": "mmm-a|S14|C1",            // deterministic aggregate key
  "programmeId": "vsdd",
  "streamId": "MMM",
  "teamId": "mmm-a",
  "sprintId": "S14",
  "checkpointId": "C1",            // week 1 / week 2 checkpoint
  "state": "SUBMITTED",            // MISSING | DRAFT | SUBMITTED | REOPENED
  "revision": 12,                  // optimistic-concurrency token (ETag)
  "schemaVersion": 1,              // document contract version
  "rag": { "business": "GREEN", "delivery": "AMBER", "release": "AMBER" },
  "hasBlocker": true,              // denormalised leadership filter field
  "hasLeadershipAsk": true,        // denormalised leadership filter field
  "createdAt": "2026-08-25T08:00:00Z",
  "updatedAt": "2026-08-26T09:14:00Z",
  "submittedAt": "2026-08-26T09:14:00Z",

  // --- flexible payload (evolves over time; validated by version-specific schema) ---
  "payload": {
    "goals": { "business": "…", "technicalTesting": "…", "sprintCommitment": "…", "nextWeekCommitment": "…" },
    "qualityEvidence": { "planned": 120, "executed": 84, "passed": 79, "openCritical": 1, "blocked": 5, "automationPercent": 18 },
    "achievements": "…",
    "aiValue": { "useCase": "…", "measurableBenefit": "…", "humanValidation": "…", "nextExperimentConstraint": "…" },
    "exceptions": [],
    "leadershipAsk": "…"
    // future sections may be added here without breaking older documents
  }
}
```

### Collections / containers

- `updates` — current mutable draft aggregate per team/checkpoint (one document, keyed by the envelope above).
- `updateVersions` — immutable submitted snapshots (append-only); each carries its own `schemaVersion`.
- `auditEvents` — append-only audit documents.
- `decisions` — leadership decisions referencing a specific `updateVersionId`.
- Reference/config documents for hierarchy, sprints, checkpoints and assignments.

Partition/shard key preference: `programmeId` (with `teamId` as a natural sub-key) to keep a programme's working set co-located and leadership queries efficient.

### Schema-version strategy

- Every document (draft, submitted version, audit event) carries `schemaVersion`.
- Old submitted documents remain readable in their original format; they are **never** bulk-rewritten.
- Reads go through version-specific validators / read adapters that upcast an older `schemaVersion` into the current in-memory domain type at read time.
- New optional sections are added to the payload without breaking older documents.
- Stable leadership filter fields (`state`, `rag`, `hasBlocker`, `hasLeadershipAsk`, hierarchy IDs) live in the envelope so filtering and indexing never depend on reaching into an arbitrary payload shape.

### Guarantees

- Submitted versions are immutable JSON snapshots.
- Audit events are append-only documents.
- Optimistic concurrency uses `revision` as an ETag; a stale `revision` on write returns `409` and overwrites nothing.
- Submission-snapshot creation and audit-event creation must be atomic within the guarantees of the selected document store (e.g. a transactional batch/transaction within a single partition).
- Flexible storage does not mean unvalidated data: application validation stays explicit through TypeScript/Zod and the API schema regardless of the store.

## 4b. Local PoC architecture decision (proof of concept only)

The following decision fixes the concrete stack used to build and run the persistence proof of concept **locally**. It is a PoC implementation choice, not a production or PTSB platform commitment. The enterprise constraints in §2 (and task 0.2) remain open.

- **Backend:** Node.js 24 LTS with TypeScript and Fastify.
- **Document database:** a local MongoDB instance started through Docker Compose.
- **MongoDB is a PoC choice only.** It is not a production or PTSB platform commitment and does not pre-empt the approved-database decision.
- **Vendor-neutral boundary:** all persistence stays behind a vendor-neutral document repository adapter (the same repository contract used by the Phase A mock). MongoDB-specific code lives only inside that adapter; the domain and API layers never depend on it.
- **Schema versioning:** stored documents retain `schemaVersion` and are read through the read-time upcasting defined in §4a. No bulk rewrites.
- **Draft writes:** use optimistic concurrency via the `revision`/ETag guard defined in §4a; a stale revision returns `409` and overwrites nothing.
- **Immutability:** submitted versions and audit events remain immutable / append-only.
- **Authentication (Phase 8):** implemented as **local accounts** — email +
  password hashed with Argon2id, Admin approval and opaque server-side sessions
  (see §5a). It sits behind small `Authenticator` / `AuthorizationPolicy`
  interfaces so a future enterprise OIDC provider can replace local
  authentication without rewriting business services. Enterprise OIDC is **not**
  implemented for the PoC and remains a future decision (task 0.2).

### Still-unresolved enterprise constraints

Production hosting, the OIDC provider and the approved database vendor remain **unresolved enterprise constraints** (see §2 and task 0.2). The local PoC choices above must not be read as resolving them.

## 5. Update state machine

```mermaid
stateDiagram-v2
  [*] --> Missing
  Missing --> Draft: first edit / autosave
  Draft --> Draft: autosave with revision check
  Draft --> Submitted: validation + submit
  Submitted --> Reopened: authorised reopen + reason
  Reopened --> Draft: new editable revision
  Submitted --> [*]: reporting cycle retained
```

UI labels:

- Missing — no draft or submission exists.
- Draft — team work is not leadership evidence.
- Submitted — immutable leadership evidence.
- Reopened — previously submitted content is being revised; latest submitted version remains visible with warning.
- Stale — submitted version belongs to an earlier checkpoint or exceeded an agreed freshness rule.

## 5a. Authentication and authorisation (local accounts, Phase 8)

The PoC uses **local account** authentication. It is deliberately structured so
that a future enterprise OIDC provider can replace only the authentication seam.

### Interfaces (the replaceable seams)

- `PasswordHasher` — `hash(password)` / `verify(hash, password)` using
  **Argon2id**. Unused once OIDC replaces local passwords.
- `SessionStore` — create / find / delete / delete-all-for-user over the
  `sessions` collection.
- `RequestAuthenticator` — resolves the request's cookie into an authenticated
  **principal** (`CurrentUser` incl. `status`) by looking up the session and
  re-reading the user + assignment on **every** request. This is the ONE seam an
  OIDC middleware replaces: it would resolve a token/claims instead of a session
  cookie and produce the same principal shape.
- `AuthorizationPolicy` — pure functions over a principal, **programme-scoped**
  (`assertActive`, `assertProgrammeMember(programmeId)`,
  `assertCanViewTeam(teamId, programmeId)`, `assertCanEditTeam(teamId, programmeId)`,
  `assertCanSubmitTeam(teamId, programmeId)`, `assertCanViewProgramme(programmeId)`,
  `assertCanRecordDecision(programmeId)`, `assertCanExport(programmeId)`,
  `assertAdmin`, `assertCanReadAudit`). The principal carries a single
  `programmeId`; a LEADERSHIP/ADMIN/AUDITOR role grants access ONLY to that
  programme, never globally — every programme-level check verifies the requested
  programme id against the principal's. Business services (Hierarchy, Draft,
  Submit, Reopen, Decision, Summary, Version, Export) call these themselves; the
  HTTP hook is defence-in-depth, not the only control. Requesting a programme
  the principal is not assigned to is a `403` **before** any lookup, so it cannot
  be used to enumerate which programmes/teams exist.

The authenticated principal (`CurrentUser`) therefore carries `programmeId` in
addition to `status`, `roles` and `assignedTeamIds`; it is populated from the
user's `Assignment` in `buildPrincipal`.

Business services keep depending on the existing `AuthContext.getCurrentUser()`
seam. In the running server that context is backed by request-scoped storage
(`AsyncLocalStorage`) populated by the authentication hook, so services never
learn whether the principal came from a local session or a future OIDC token.

The frontend talks to these endpoints through a small `AuthClient` seam. Its
**default runtime mode is the real HTTP client** (session cookie,
`credentials: 'include'`, base URL from `VITE_API_BASE_URL` or the Vite `/api`
dev proxy). An in-memory mock client is used ONLY when `VITE_AUTH_MODE=mock`
(tests/demo); the app never silently falls back to mock authentication when the
backend is unreachable — it shows an explicit connection-error state.

### Registration → approval flow

```mermaid
stateDiagram-v2
  [*] --> PENDING: POST /auth/register (display name, email, password, requested team?)
  PENDING --> ACTIVE: Admin approve + assign programme/team/roles
  PENDING --> REJECTED: Admin reject
  ACTIVE --> SUSPENDED: Admin suspend
  PENDING --> [*]: cannot access programme data
  REJECTED --> [*]: access denied
  SUSPENDED --> [*]: access lost on next request
```

- Registration stores a `PENDING` user (Argon2id hash) and appends a
  `USER_REGISTERED` audit event. `PENDING` users may sign in (to see the pending
  screen) but cannot reach programme data.
- Login verifies the password, and for `PENDING`/`ACTIVE` accounts issues a
  random opaque session; `REJECTED`/`SUSPENDED` accounts are refused. A failed
  login appends `LOGIN_FAILED` (no password/token recorded).
- Approval sets `ACTIVE` and writes the `assignments` document; the user gains
  access on the next request because the authenticator re-reads status +
  assignment every time. A user can never approve/reject/suspend or assign
  their own account (self-service escalation is refused server-side).

### Sessions and cookies

- The session token is 256 bits of CSPRNG randomness, base64url-encoded, sent
  only in an `HttpOnly`, `SameSite=Lax`, `Path=/` cookie. `Secure` is set
  outside local development. Tokens are never placed in `localStorage`.
- The `sessions` document is keyed by the **SHA-256 hash** of the token, so a
  database disclosure never yields a usable session. Sessions carry `expiresAt`;
  an expired or missing/unknown session is a `401 SESSION_EXPIRED`. Logout and
  suspension delete the session server-side (revocation).
- `expiresAt` is stored as a **BSON `Date`** carrying a **TTL index**
  (`expireAfterSeconds: 0`) so MongoDB reaps expired sessions automatically;
  reads ALSO check expiry explicitly so an expired session is rejected
  immediately, before the background TTL monitor runs. The domain/API contract
  keeps `expiresAt` as an ISO string.

### Persisted audit history

Account/security events (`USER_REGISTERED`, `USER_APPROVED`, `USER_REJECTED`,
`ASSIGNMENT_CHANGED`, `USER_SUSPENDED`, `LOGIN_FAILED`, `LOGOUT`) are appended to
the `auditEvents` collection, so the history survives restarts and is visible
from any authorised session. `GET /api/v1/audit` serves it newest-first, paged,
filterable by `userId`/`entityId`/`action`, restricted to **Admin and Auditor**.
The response is a sanitised projection: only stable ids, action, actor, entity/
aggregate ids and timestamp — never a password, session token or user-authored
content (e.g. a reopen reason).

### Permission matrix

| Capability / endpoint | CONTRIBUTOR | TEAM_LEAD | LEADERSHIP | ADMIN | AUDITOR |
|---|---|---|---|---|---|
| `GET /me` (any authenticated status) | ✓ | ✓ | ✓ | ✓ | ✓ |
| View hierarchy / assigned team update | scope | scope | ✓ | ✓ | ✓ |
| `PUT` draft (save) | scope | scope | — | — | — |
| `POST` submit | — | scope | — | — | — |
| `POST` reopen | — | scope | — | — | — |
| Leadership summary / filtered projection | — | — | ✓ | ✓ | ✓ |
| Version history / audit / compare | scope | scope | ✓ | ✓ | ✓ |
| `POST` decision | — | — | ✓ | ✓ | — |
| `POST` export | — | — | ✓ | ✓ | — |
| Persisted audit history (`GET /audit`) | — | — | — | ✓ | ✓ |
| Admin user/assignment endpoints | — | — | — | ✓ | — |

"scope" = allowed only for teams in the user's assignment. **Every row is also
programme-scoped**: a LEADERSHIP/ADMIN/AUDITOR role applies only to the
principal's assigned programme, so cross-programme access is refused. All rows
additionally require `status = ACTIVE`; `PENDING`/`REJECTED`/`SUSPENDED` are
denied for everything except `GET /me`. Authorisation is **default-deny**:
anything not explicitly granted is refused in the API, not merely hidden in the
UI, and is enforced inside the services (not only at the HTTP edge).

### Admin assignment validation + atomic identity workflows

Admin approval / assignment changes are validated server-side against real
reference data: the `programmeId` must exist, every `teamId` must exist, be
active and belong to that programme, and a Contributor/Team-Lead assignment
requires at least one team — phantom or cross-programme ids are rejected with
`VALIDATION_FAILED`.

Identity workflows that touch more than one collection are **atomic** (a single
document-store transaction; the in-memory adapter uses staged-commit rollback):
registration (user + `USER_REGISTERED`), approval (ACTIVE status + assignment +
`USER_APPROVED` + `ASSIGNMENT_CHANGED`), assignment change (assignment + audit),
rejection/suspension (status + session revocation + audit) and the first-admin
bootstrap (user + ADMIN assignment + `ADMIN_BOOTSTRAPPED`). A mid-way failure
rolls everything back, so an interrupted workflow never leaves an ACTIVE user
without an assignment (bootstrap is safely retryable).

## 6. API design

### Authentication and admin endpoints (local accounts, Phase 8)

```http
POST /api/v1/auth/register        // { displayName, email, password, requestedTeam? } -> 201 PENDING
POST /api/v1/auth/login           // { email, password } -> 200 + Set-Cookie session; 401 on failure
POST /api/v1/auth/logout          // clears + revokes the session
GET  /api/v1/me                   // authenticated principal incl. status (session-backed)
GET  /api/v1/admin/users?status=PENDING   // admin: users filtered by status
POST /api/v1/admin/users/{userId}/approve // admin: approve (with programme/team/roles)
POST /api/v1/admin/users/{userId}/reject  // admin: reject a pending user
PUT  /api/v1/admin/users/{userId}/assignments // admin: set/modify programme/team/roles
POST /api/v1/admin/users/{userId}/suspend // admin: suspend + revoke sessions
GET  /api/v1/audit?userId=&entityId=&action=&limit=&offset= // admin/auditor: persisted audit history
```

Registration and login are rate-limited. `401` marks unauthenticated / expired
sessions; `403` marks an authenticated-but-unauthorised request; `429` marks a
rate-limited request. Password hashes are never returned by any endpoint.

### Read endpoints

```http
GET /api/v1/me
GET /api/v1/programmes/{programmeId}/hierarchy
GET /api/v1/programmes/{programmeId}/sprints?status=current
GET /api/v1/programmes/{programmeId}/reporting-summary?sprintId=&checkpointId=&streamId=&rag=&state=
GET /api/v1/teams/{teamId}/updates/{checkpointId}
GET /api/v1/teams/{teamId}/updates/{checkpointId}/versions
GET /api/v1/updates/{versionId}
GET /api/v1/updates/{versionId}/audit
```

### Write endpoints

```http
PUT  /api/v1/teams/{teamId}/drafts/{checkpointId}
POST /api/v1/teams/{teamId}/drafts/{checkpointId}/submit
POST /api/v1/updates/{versionId}/reopen
POST /api/v1/updates/{versionId}/decisions
POST /api/v1/programmes/{programmeId}/exports
```

> **Export (PoC scope).** For the local PoC, `POST .../exports` returns a
> **synchronous structured JSON snapshot** of the filtered Leadership View
> population in the response body — the agreed export format (R16.1, task 0.2).
> It reuses the leadership filtered projection (so the export matches the
> visible population), enforces the programme-permission gate before any
> programme lookup (anti-enumeration), and appends an append-only
> `EXPORT_CREATED` security-audit event on success (R15). Asynchronous export
> **jobs** and downloadable **artifact storage** are intentionally out of scope
> for the PoC and are **deferred to a future production decision**; R16 does not
> require them.

> **Update audit history.** `GET /api/v1/updates/{versionId}/audit` returns the
> **complete, newest-first** audit trail for the whole update the version
> belongs to (submit, reopen, resubmit and leadership-decision events). Every
> event shares a stable update-aggregate id (`${teamId}|${sprintId}|
> ${checkpointId}`); an unknown version id is a `404`, never an empty `200`.

### Draft update contract

Every `PUT` carries:

```json
{
  "revision": 12,
  "rag": {
    "business": "GREEN",
    "delivery": "AMBER",
    "release": "AMBER"
  },
  "goals": {
    "business": "...",
    "technicalTesting": "...",
    "sprintCommitment": "...",
    "nextWeekCommitment": "..."
  },
  "qualityEvidence": {
    "planned": 120,
    "executed": 84,
    "passed": 79,
    "openCritical": 1,
    "blocked": 5,
    "automationPercent": 18
  },
  "achievements": "...",
  "aiValue": {
    "useCase": "...",
    "measurableBenefit": "...",
    "humanValidation": "...",
    "nextExperimentConstraint": "..."
  },
  "exceptions": [],
  "leadershipAsk": "..."
}
```

The API returns the new `revision`, `updatedAt` and `updatedBy`. If the supplied revision is stale, return `409 Conflict` with server metadata and do not overwrite either version.

### Error envelope

```json
{
  "error": {
    "code": "DRAFT_REVISION_CONFLICT",
    "message": "This draft changed after you opened it.",
    "correlationId": "...",
    "fieldErrors": []
  }
}
```

User-facing copy must explain what happened and the next action. Do not show raw stack traces or generic “Something went wrong” errors.

## 7. Frontend structure

```text
src/
  app/
    routes.tsx
    queryClient.ts
    auth/
  domain/
    update.ts
    hierarchy.ts
    schemas.ts
  api/
    client.ts
    updateApi.ts
    leadershipApi.ts
  features/
    team-update/
      TeamUpdatePage.tsx
      UpdateContextRail.tsx
      RagSelector.tsx
      GoalsCommitmentsSection.tsx
      QualityEvidenceSection.tsx
      AchievementsSection.tsx
      AiValueSection.tsx
      ExceptionEditor.tsx
      LeadershipAskField.tsx
      SubmissionBar.tsx
    leadership/
      LeadershipPage.tsx
      LeadershipFilters.tsx
      ProgrammeSummary.tsx
      HierarchyTree.tsx
      TeamStatusRow.tsx
      SprintWeekNodes.tsx
      TeamUpdateDetail.tsx
  components/
    Button.tsx
    Field.tsx
    StatusDot.tsx
    StatusChip.tsx
    EmptyState.tsx
    ErrorState.tsx
    Skeleton.tsx
    Toast.tsx
  styles/
    tokens.css
    global.css
```

Component rules:

- `RagSelector` is a semantic radio group and always renders text with colour.
- `HierarchyTree` owns expansion state, keyboard traversal and selected path; it does not own fetched update data.
- `TeamUpdateDetail` renders an immutable DTO and never sends writes.
- `ExceptionEditor` uses stable IDs; do not identify rows by array index after persistence.
- Forms use visible labels. Placeholders are examples only.

## 8. Team Update interaction design

### Page structure

1. Sticky application navigation.
2. Page title and save/submission state.
3. Context rail: stream, team, sprint and week.
4. Three RAG selectors.
5. Goals & commitments with four explicit fields.
6. Quality evidence, achievements and AI value.
7. Editable exception table.
8. Leadership ask.
9. Sticky Save draft / Submit update action bar.

### Autosave

- Debounce after meaningful field changes.
- Display `Saving draft…`, `Draft saved at HH:MM`, or an actionable failure state.
- Keep unsaved text in memory if the API fails.
- On navigation with a pending/failed save, warn before discarding content.
- Never change a submitted version silently; editing it begins the authorised reopen flow.

### Validation

- Validate individual fields on blur.
- Validate the full update on submit.
- Focus the first invalid field and show an error summary linked to invalid controls.
- Warnings about metric inconsistencies are overridable only with an explanation.
- Amber/Red without an exception or rationale is a blocking submission error.

## 9. Leadership View interaction design

### Hierarchy

- Left master pane shows Programme → Stream → Team.
- Selecting a team reveals Sprint → Week below that team and loads detail in the right pane.
- Each team row shows B/T/R status and update state.
- Tree nodes support mouse, touch and keyboard interaction; expansion must not depend on hover.

### Detail

Order is fixed:

1. Breadcrumb and version state.
2. Three RAG blocks.
3. Goals & commitments.
4. Quality evidence.
5. Week trajectory and AI value.
6. Risks / issues / blockers.
7. Leadership ask and recorded leadership decision.

### Filters

- Stream, any RAG status and update state.
- Filters update the tree and programme counts together.
- Preserve selected item if it remains visible; otherwise select the first visible item and announce the context change.
- Provide a reset action in the zero-result state.

## 10. Visual system

Use the approved prototype as the source of truth.

### Palette

- PTSB orange `#FC4C02`: active navigation and primary actions only.
- Graphite `#2E2C2B`: primary text.
- Neutral white `#FFFFFF`, subtle surface `#FAF9F7`, divider `#DEDAD6`.
- Aqua `#C7EEF0` / dark aqua `#23747B`: hierarchy metadata and secondary emphasis.
- Green `#2F8F5B`, Amber `#E7A400`, Red `#C84038`: status semantics only.

Production CSS may use approved OKLCH equivalents, but exported documents and design tokens must retain the brand hex references.

### Typography and density

- Aptos or approved metric-compatible humanist sans.
- Fixed product type scale: 12 / 14 / 16 / 20 / 24 / 32 px equivalent in rem.
- 4-point spacing foundation: 4 / 8 / 12 / 16 / 24 / 32 / 48.
- Flat tonal layers and 1 px dividers. Avoid decorative shadows.
- Card/container radius: 4–12 px; no excessive rounding.

### Prohibited visual patterns

- No gradients, glassmorphism or decorative grid backgrounds.
- No giant “hero metric” treatment.
- No wall of identical cards or nested cards.
- No coloured side stripes on alert cards.
- No RAG colour without a text label.
- No PowerPoint slide embedded as a page layout.

## 11. Responsive design

- Desktop ≥1024 px: persistent context/tree master pane and detail pane.
- Tablet 768–1023 px: master pane above or beside detail based on available width; 44 px targets.
- Phone <768 px: single-column authoring; leadership hierarchy becomes a collapsible master section above detail; tables reflow into labelled records.
- Core fields and exceptions remain editable on phone.
- Sticky action bar becomes in-flow when it would obscure content or the virtual keyboard.

## 12. Accessibility

- WCAG 2.2 AA target.
- Use landmarks, headings, fieldsets, legends, labels and table semantics.
- Tabs implement roving tabindex and arrow-key navigation.
- Tree interaction follows the WAI-ARIA tree pattern or a simpler disclosure/list pattern with equivalent keyboard clarity.
- Focus remains visible and moves intentionally after validation, submission and selection changes.
- Announce save, submit, filter and conflict outcomes through a polite live region.
- Do not disable browser zoom.
- Respect `prefers-reduced-motion`.

## 13. Security design

- Validate and authorise every request server-side against programme/team assignments (default-deny).
- Hash passwords with Argon2id; never store or log plaintext passwords; never return a password hash from any endpoint.
- Use random, opaque, server-side sessions; store only the token's hash; send only the session id in an `HttpOnly`, `SameSite` cookie; set `Secure` outside local development; never persist auth tokens in localStorage.
- Re-validate account status and assignments on every authenticated request so a rejected/suspended account loses access immediately; delete sessions on logout and suspension.
- Rate-limit registration and login; a user can never approve/assign/suspend their own account.
- Encode user-authored text on output; do not render stored HTML.
- Apply a minimal CSP with an allowlist appropriate to the deployment; keep it local-HTTP friendly for development.
- Add CSRF protection for state-changing requests.
- Use parameterised / server-side-constructed queries; never build datastore queries from raw user input regardless of the selected document store.
- Protect export endpoints against programme-data enumeration; return generic responses on login, registration and export that avoid account or data enumeration.
- Separate audit-event access from general application logs.

### PoC hardening scope (Phase 10)

Phase 10 hardens the **local internal PoC** and does not make it production-ready.
It covers the secure local-auth baseline, log hygiene, minimal abuse protection,
draft-recovery verification, lightweight UI checks and a local readiness benchmark
(8 teams plus a 2× growth margin) with basic latency/error counters and a concise
residual-risk checklist. Deferred to Phase B, alongside the OIDC, production
database and hosting decisions: production-scale load testing, an enterprise
observability platform, Edge/Firefox certification, formal penetration testing and
a full enterprise threat-model and security approval.

## 14. Test strategy

### Unit

- Domain validation and derived rates.
- RAG/exception rules.
- State transitions and permission policy.
- Filter predicates and summary calculations.

### Component

- RAG selector keyboard interaction.
- Required goal fields and error linking.
- Exception add/edit/resolve flow.
- Autosave states and retry.
- Hierarchy selection and filter zero state.

### API integration

- Team-scoped authorisation.
- Atomic submit plus audit creation.
- `409` conflict handling.
- Reopen reason and immutable prior version.
- Export scoping.

### Authentication and authorisation (Phase 8)

- Registration and duplicate-email handling; Argon2id hashing (hash ≠ plaintext, verify true/false).
- Login success / wrong password / unknown user / rate limiting.
- Session creation, expiry, logout and suspension-driven revocation.
- `PENDING`, `REJECTED` and `SUSPENDED` access denial; approval grants access on the next request.
- Team-Contributor vs Team-Lead scoping and Leadership/Admin/Auditor permissions.
- Privilege-escalation attempts (self-approve / self-assign / non-admin admin call) refused.
- Negative authorisation for **every** protected write, reopen, decision, admin and export endpoint (401 unauthenticated, 403 unauthorised).
- Passwords and session tokens absent from API responses and audit events.
- `bootstrap-admin` idempotency.

### End to end

1. Contributor edits and auto-saves a draft.
2. Team Lead submits it.
3. Leadership sees the same values under the correct hierarchy path.
4. Leadership records a decision against the ask.
5. Authorised lead reopens, changes and resubmits; audit comparison retains both versions.
6. Two editors produce a conflict without silent data loss.

### Accessibility and visual regression

- Automated axe (WCAG 2.2 AA) scan on both primary screens and error/empty states.
- Manual keyboard smoke test covering the complete draft → submit → leadership drill-down.
- Visual regression at 1440×1000 and 390×844 for the PoC (the intermediate 1024×768 and 768×1024 breakpoints remain design targets in §11 but are not gated by the PoC visual-regression run).
- Verify RAG meaning in grayscale and with common colour-vision simulations.
- Chrome is the supported browser for the PoC; Safari is smoke-tested only. Edge/Firefox certification is deferred to Phase B.

## 15. Migration path from prototype

1. Extract prototype colours, spacing and components into `tokens.css`.
2. Port seed hierarchy into a typed fixture and mock API adapter.
3. Build React screens against repository interfaces, not direct browser storage.
4. Implement the server API and document-store containers/collections (see §4a); no relational migration step is implied.
5. Swap the mock adapter for the real API behind the same query hooks.
6. Add local-account authentication/RBAC (behind interfaces that a future OIDC provider can replace), audit, notifications and export.
7. Run the acceptance and security suites before pilot rollout.
