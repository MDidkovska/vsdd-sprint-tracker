# Prompt for Kiro

Implement the VSDD Sprint Tracker described in this folder.

Start by reading, in order:

1. `.kiro/specs/vsdd-sprint-tracker/requirements.md`
2. `.kiro/specs/vsdd-sprint-tracker/design.md`
3. `.kiro/specs/vsdd-sprint-tracker/tasks.md`
4. `index.html`, `styles.css` and `app.js` as the approved interaction and visual prototype

The target is ultimately a secure multi-user enterprise web application, but implementation must be phased:

- First reproduce the approved Team Update and Leadership View in typed, componentised production frontend code using a replaceable mock repository.
- Then implement the API, PostgreSQL persistence, OIDC/RBAC, optimistic concurrency, immutable submissions, audit history, notifications and export described in the specification.

Non-negotiable product rules:

- The hierarchy is Programme → Stream → Team → Sprint → Week.
- Leadership View is derived from the same data entered in Team Update; never create a second manual leadership record.
- Preserve four explicit fields in both views: Business goal, Technical / testing goal, Sprint commitment and Next week commitment.
- Preserve three independent RAG statuses: Business outcome, Test delivery and Release confidence.
- Keep Risk, Issue and Blocker distinct. Every item requires business/release impact, owner, due date and decision/support needed.
- Draft, Missing, Stale and Reopened are not submitted evidence.
- Never allow silent last-write-wins data loss.
- Preserve the approved light PTSB visual language. Do not replace it with a generic component-library theme.
- Meet the accessibility, security and test requirements in the spec.

Before writing production code, complete Phase 0 tasks and report:

1. detected repository/framework constraints;
2. proposed implementation stack and any deviation from `design.md`;
3. data/API boundaries;
4. the first vertical slice and its acceptance tests.

Then work through `tasks.md` in order, marking tasks complete only after tests pass. Do not skip error, empty, loading, conflict, stale and permission states.
