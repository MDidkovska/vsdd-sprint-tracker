# VSDD Sprint Tracker — Requirements

## 1. Objective

Build a multi-user web application that replaces manually assembled weekly testing slides. Testing teams enter one structured update per team, sprint and week; leadership reviews the same submitted data through the hierarchy:

`Programme → Stream → Team → Sprint → Week`

The product must preserve the business meaning behind test metrics. A green status without evidence, a stale update, or a missing submission must never be presented as release confidence.

## 2. Scope and delivery phases

### Phase A — approved interface prototype

- Reproduce and componentise the supplied HTML prototype.
- Use seeded data and a replaceable local data adapter.
- Support both Team Update and Leadership View workflows.
- Preserve the approved PTSB visual system and responsive behaviour.

### Phase B — multi-user product

- Add authentication, role-based access, shared persistence, concurrency handling, audit history, notifications and governed administration.
- Replace the local adapter without changing the UI domain model.
- For the PoC, authentication is **local accounts** (email + password with Admin
  approval, R1). Enterprise identity (OIDC / Entra ID / Auth0 / Okta / Keycloak)
  and the hosting standard selected by PTSB/EPAM remain future decisions
  (task 0.2); local authentication sits behind small interfaces so it can be
  replaced without rewriting business services.

## 3. Users and permissions

| Role | Core permissions |
|---|---|
| Team Contributor | Create and edit drafts for assigned teams; view their own current and prior updates |
| Team Lead | Contributor permissions; submit an update; reopen a submitted update with reason |
| Programme Leadership | View all streams and submitted evidence; filter, export and request changes; cannot silently edit team evidence |
| Programme Admin | Configure streams, teams, sprint dates, reporting windows, assignments and role membership |
| Auditor / Read-only | View submitted versions and audit history; no write access |

## 4. Domain hierarchy

Initial hierarchy:

- MMM
  - PTSB-VSDD MMM A
  - PTSB-VSDD MMM B
- OAH
  - PTSB-VSDD OAH ILS
  - PTSB-VSDD OAH Sales
- GRMB
  - PTSB-VSDD GRMB
- O24
  - PTSB-VSDD O24 App Modernization
  - PTSB-VSDD O24 Desktop Sunset
- Visa
  - VIS-PMNT

Hierarchy must be configurable; these values are seed data, not hard-coded production rules.

## 5. Functional requirements

### R1 — Authentication and authorisation (local accounts)

> **Identity approach (decided for the PoC).** The application uses **local
> account** authentication: users register directly with an email and password,
> and an Admin approves and assigns them. Enterprise identity (OIDC / Entra ID /
> Auth0 / Okta / Keycloak) is **not** implemented and remains a future
> production decision (task 0.2). Authentication and authorisation sit behind
> small server-side interfaces so a future OIDC provider can replace local
> authentication without rewriting the business services.

1. THE SYSTEM SHALL let a person self-register with a display name, email,
   password and an optional free-text requested team. A new registration is
   stored with status `PENDING`.
2. THE SYSTEM SHALL hash passwords with **Argon2id** and SHALL never store or
   log plaintext passwords, and SHALL never expose a password hash through any
   API response.
3. WHEN a user signs in with valid credentials, THE SYSTEM SHALL create a
   random, opaque, server-side session stored in the database and SHALL return
   only the session identifier in an `HttpOnly`, `SameSite` cookie. Secure
   cookies SHALL be enabled outside local development. Authentication tokens
   SHALL NOT be stored in `localStorage`.
4. THE SYSTEM SHALL load programme, stream and team permissions from server-side
   role assignments and SHALL revalidate account status and assignments on every
   authenticated request. A `PENDING`, `REJECTED` or `SUSPENDED` account SHALL
   NOT access programme data.
4a. Authorisation SHALL be **programme-scoped**: the authenticated principal is
    assigned to a single programme, and a Leadership, Admin or Auditor role
    grants access ONLY to that programme — never to another programme's data.
    Every programme-level check SHALL verify the requested programme id against
    the principal's assignment, and a request for a programme the principal is
    not assigned to SHALL be refused before any lookup (no enumeration). These
    checks SHALL be enforced inside the API services, not only at the HTTP edge.
5. WHEN an Admin approves a user and assigns a programme, stream/team and roles,
   the account SHALL become `ACTIVE` and SHALL gain the assigned access on the
   user's next authenticated request.
6. THE SYSTEM SHALL apply **default-deny** authorisation and SHALL enforce every
   permission in the API; hiding a control in the UI is not sufficient
   authorisation.
7. IF a user requests a team update they are not authorised to edit, THE SYSTEM
   SHALL return read-only content or a clear access-denied state without
   exposing hidden programme data.
8. A user SHALL NEVER be able to assign their own roles or teams, or approve,
   reject or suspend their own account.
9. THE SYSTEM SHALL rate-limit registration and login attempts.
10. THE SYSTEM SHALL record the following as security-relevant audit events:
    registration, approval, rejection, assignment change, suspension, login
    failure and logout. Audit events SHALL NOT contain passwords, session tokens
    or user-authored status content.

### R1a — Account lifecycle and administration

1. An account SHALL be in exactly one state: `PENDING`, `ACTIVE`, `REJECTED` or
   `SUSPENDED`.
2. THE SYSTEM SHALL provide an Admin Console that lists users filtered by
   status, starting with a `PENDING` approval queue.
3. An Admin SHALL be able to approve or reject a user; assign the programme,
   stream/team and roles; modify existing assignments; and suspend an account.
4. Approving requires assigning at least one role; a rejected or suspended
   account SHALL immediately lose access on its next request.
4a. Assignments SHALL be validated server-side against real reference data: the
    programme must exist, every team must exist, be active and belong to that
    programme, and a Contributor/Team-Lead assignment must include at least one
    team. Phantom or cross-programme ids SHALL be rejected (`VALIDATION_FAILED`).
4b. Registration, approval, assignment change, rejection/suspension and the
    first-admin bootstrap SHALL be atomic — the account/assignment/session and
    audit writes succeed or roll back together. An interrupted workflow SHALL
    never leave an ACTIVE user without an assignment, and the bootstrap SHALL be
    safely retryable.
5. THE SYSTEM SHALL provide an interactive local command to securely create the
   first Admin account without placing the password in shell history or source
   control. The command SHALL be idempotent.
6. THE SYSTEM SHALL use the MongoDB collections `users`, `assignments`,
   `sessions` and `auditEvents`. There is no separate access-request collection:
   the Admin pending queue queries `users` by `status=PENDING`, and `auditEvents`
   retains the approval/rejection decision history.

### Local authentication and administration endpoints

```http
POST /api/v1/auth/register
POST /api/v1/auth/login
POST /api/v1/auth/logout
GET  /api/v1/me
GET  /api/v1/admin/users?status=PENDING
POST /api/v1/admin/users/{userId}/approve
POST /api/v1/admin/users/{userId}/reject
PUT  /api/v1/admin/users/{userId}/assignments
POST /api/v1/admin/users/{userId}/suspend
```

### R2 — Reporting-cycle configuration

1. A Programme Admin SHALL be able to create a sprint with name/number, start date, end date and two weekly checkpoints.
2. THE SYSTEM SHALL identify one reporting checkpoint as current and retain prior checkpoints as immutable submitted versions.
3. IF a reporting window is closed, THE SYSTEM SHALL prevent normal edits and offer an authorised reopen workflow with a required reason.

### R3 — Team context

1. WHEN a contributor opens Team Update, THE SYSTEM SHALL show only streams and teams assigned to that user.
2. WHEN the user changes stream, team, sprint or week, THE SYSTEM SHALL load the matching draft or submitted update.
3. THE SYSTEM SHALL preserve unsaved changes before changing context or explicitly warn the user what will be lost.

### R4 — RAG status

1. EACH update SHALL contain separate Green / Amber / Red values for Business outcome, Test delivery and Release confidence.
2. EACH RAG control SHALL include a visible text label; colour alone SHALL NOT carry meaning.
3. WHEN a RAG value is Amber or Red, THE SYSTEM SHALL require at least one linked risk, issue or blocker, or a written rationale.
4. WHEN leadership views a team row, THE SYSTEM SHALL display all three statuses independently.

### R5 — Goals and commitments

1. EACH submitted update SHALL require Business goal, Technical / testing goal, Sprint commitment and Next week commitment.
2. EACH field SHALL support at least 1,000 characters and preserve line breaks.
3. Leadership View SHALL display the four values under the explicit labels used in Team Update.
4. THE SYSTEM SHALL NOT infer or rewrite a team’s submitted goal without showing the change and retaining the original version.

### R6 — Quality evidence

1. EACH update SHALL collect Planned tests, Executed tests, Passed tests, Open critical defects, Blocked tests and Automation percentage.
2. Numeric values SHALL be non-negative; Automation SHALL be between 0 and 100.
3. THE SYSTEM SHALL warn when Passed exceeds Executed or Executed exceeds Planned, but SHALL allow an authorised user to explain and submit an accepted exception.
4. THE SYSTEM SHALL calculate execution rate and pass rate from submitted values; derived values SHALL NOT be manually entered.
5. Leadership View SHALL present counts with their labels and reporting period.

### R7 — Weekly achievements

1. EACH update SHALL provide an Achievements this week field.
2. Guidance SHALL ask what changed against the current week commitment, including result and evidence rather than activity alone.
3. Leadership View SHALL display achievements as a concise week trajectory without losing the submitted text in the detail/audit view.

### R8 — AI value

1. EACH update SHALL provide four distinct AI fields: Use case, Measurable benefit, Human validation and Next experiment / constraint.
2. IF an AI use case is reported, THE SYSTEM SHALL require human validation and either a measurable benefit or an explicit “not measured” explanation.
3. Leadership View SHALL preserve the sequence `Use case → measurable benefit → human validation → next experiment / constraint`.

### R9 — Risks, issues and blockers

1. A team SHALL be able to add zero or more exception items.
2. EACH item SHALL have one type:
   - Risk — may affect delivery or release.
   - Issue — already affects delivery or release.
   - Blocker — stopped a specific piece of work.
3. EACH item SHALL require Business / release impact, Owner, Due date and Decision / support needed.
4. THE SYSTEM SHALL allow an item to be marked resolved with resolution date and resolution note while preserving its history.
5. Leadership View SHALL show multiple items and SHALL NOT collapse Risk, Issue and Blocker into one generic warning.

### R10 — Leadership ask

1. EACH update SHALL contain one Leadership ask field or the explicit value “None”.
2. Leadership View SHALL count non-empty asks and make them visible without opening every team.
3. Programme Leadership SHALL be able to record a decision against an ask without editing the team’s original ask.

### R11 — Draft and submission workflow

1. THE SYSTEM SHALL auto-save editable drafts and show Saved, Saving and Save failed states.
2. WHEN a Team Lead submits an update, THE SYSTEM SHALL validate required fields and create a versioned submission.
3. A submitted update SHALL be read-only until reopened by an authorised role.
4. WHEN a submitted update is reopened, THE SYSTEM SHALL record actor, timestamp and reason.
5. WHEN two users edit the same draft, THE SYSTEM SHALL detect a version conflict and prevent silent last-write-wins data loss.

### R12 — Leadership hierarchy and drill-down

1. Leadership View SHALL present the hierarchy Programme → Stream → Team → Sprint → Week as an expandable tree.
2. EACH team row SHALL show the three RAG statuses and submission state.
3. WHEN a user selects a week node, THE SYSTEM SHALL show the exact submitted version for that team/sprint/week.
4. IF an update is Draft, Missing, Stale or Reopened, THE SYSTEM SHALL display that state explicitly and SHALL NOT treat it as submitted evidence.

### R13 — Filters and programme summary

1. Leadership SHALL be able to filter by stream, any RAG status and update state.
2. Summary counts SHALL recalculate against the filtered population and state the active reporting period.
3. THE SYSTEM SHALL show team count, submitted count, draft/missing count and leadership-ask count.
4. An empty filter result SHALL explain that no teams match and provide a clear route to reset filters.

### R14 — History and audit evidence

1. THE SYSTEM SHALL retain every submitted version, reopen event and leadership decision.
2. Audit records SHALL include actor ID, timestamp, action, entity ID, previous version and new version.
3. Authorised users SHALL be able to compare two update versions field by field.
4. Audit data SHALL be append-only to application users.
5. THE SYSTEM SHALL persist account/security events — `USER_REGISTERED`,
   `USER_APPROVED`, `USER_REJECTED`, `ASSIGNMENT_CHANGED`, `USER_SUSPENDED`,
   `LOGIN_FAILED`, `LOGOUT` — in the `auditEvents` collection so they remain
   available after an application restart and from any authorised session.
6. THE SYSTEM SHALL expose a read-only audit-history endpoint
   (`GET /api/v1/audit`) restricted to Admin and Auditor, returning results
   newest-first with pagination and filters for `userId`, `entityId` and
   `action`. The response SHALL NOT contain password hashes, session tokens or
   user-authored status content.

### R15 — Notifications

1. THE SYSTEM SHALL notify assigned Team Leads before a reporting deadline when an update is Draft or Missing.
2. THE SYSTEM SHALL notify Programme Leadership when an update is submitted with Red release confidence, a Blocker or a Leadership ask.
3. Notifications SHALL deep-link to the exact team, sprint and week.
4. Notification delivery failures SHALL NOT change submission state.

### R16 — Export

1. Leadership SHALL be able to export the current filtered snapshot in an agreed structured format.
2. An export SHALL include reporting period, filter context, version timestamps, RAG labels, goals, evidence, AI value, exceptions and leadership asks.
3. Exports SHALL mark Draft, Missing and Stale updates visibly.
4. Export access SHALL follow the same programme permissions as the UI.

### R17 — Administration

1. Programme Admin SHALL configure programme hierarchy without a code deployment.
2. Removing a team SHALL archive it rather than deleting historical submissions.
3. Team names SHALL be unique within a stream for the active period.
4. Assignment changes SHALL take effect without changing historical authorship.

## 6. Non-functional requirements

### Security and privacy

- For the PoC, use **local account** authentication: hash passwords with
  Argon2id, never store or log plaintext passwords, and never expose a password
  hash. Enterprise OIDC/OAuth 2.0 is a future decision (task 0.2) and must be
  swappable behind the authentication interface.
- Use random, opaque, server-side sessions stored in the database; send only the
  session identifier in an `HttpOnly`, `SameSite` cookie; enable secure cookies
  outside local development; never persist auth tokens in `localStorage`.
- Sessions SHALL carry an expiry; the store SHALL clean up expired sessions
  (a database TTL index), and an expired session SHALL be rejected immediately on
  the next request even before TTL cleanup runs.
- Rate-limit registration and login; apply default-deny authorisation.
- Enforce least privilege and server-side tenant/programme scoping.
- Encrypt data in transit and at rest using approved platform controls.
- Do not log free-text update content, tokens or personal data in application logs.
- Record security-relevant events: role changes, failed authorisation, reopen and export.
- Apply CSRF protection, secure cookies, CSP and output encoding appropriate to the selected architecture.

### Reliability and concurrency

- Draft auto-save target: visible confirmation within two seconds at p95 under normal load.
- Use optimistic concurrency with a version/ETag on mutable updates.
- Submission creation and audit-event creation must be atomic.
- A failed save must leave the user’s unsaved content available for retry.

### Performance

- Leadership View target: interactive within three seconds at p75 for up to 200 teams and 24 months of history on a standard enterprise laptop/network.
- Load only the current tree and selected detail initially; fetch history on demand.
- Filtering current-cycle data should complete within one second at p95.

### Accessibility and responsive behaviour

- Meet WCAG 2.2 AA for the supported browser set.
- Support keyboard-only workflows, visible focus, semantic labels and text in addition to RAG colour.
- Support browser zoom to 200% without loss of content or action.
- Primary target is enterprise laptop; tablet is fully supported; phone retains all core functionality through stacked/progressive layouts.
- Respect reduced-motion preferences.

### Browser support

- Current and previous major versions of Edge and Chrome are required.
- Safari and Firefox support should be confirmed with the product owner before production hardening.

## 7. Out of scope for the first production increment

- Automatic RAG calculation that overrides human judgement.
- AI rewriting of submitted updates without explicit review and acceptance.
- Direct Jira/Xray integration before the manual workflow and data contract are validated.
- Cross-programme benchmarking without agreed metric definitions.
- Native mobile applications.

## 8. Definition of done

- Both approved interfaces are implemented against the same API/domain model.
- Every Leadership View value traces to a Team Update field or a transparent derived calculation.
- Role and submission workflows pass automated API and UI tests.
- Accessibility scan and keyboard walkthrough pass with no critical findings.
- Conflict, stale, missing, empty, loading, error and success states are demonstrably covered.
- Audit history proves who submitted/reopened/decided what and when.
