# PoC security & residual-risk checklist (task 10.6)

Concise security evidence for the **local internal proof of concept**. This is
**not** a production-readiness gate or a security sign-off. It records the
controls the PoC hardening (Phase 10) put in place, the risks knowingly
accepted for a local internal PoC, and what is explicitly **deferred to
Phase B** (production hardening — see task 0.2 and design.md §13 "PoC hardening
scope").

Covers requirements.md §6 (Security, Reliability & concurrency) and design.md
§13 (Security design).

## Scope statement

- The PoC runs **locally / on an internal network** with **mocked-then-local
  authentication**; it holds demonstration data, not production programme data.
- Enterprise OIDC, a production database, production hosting, TLS termination
  and secrets management are **Phase B** decisions. Do **not** treat this PoC as
  production-ready or expose it to untrusted networks.

## Controls in place (Phase 10 PoC hardening)

| # | Control | Status | Where | Task |
| --- | --- | --- | --- | --- |
| 1 | Passwords hashed with Argon2id; never stored/logged/returned in plaintext | Done | `server/src/auth/passwordHasher.ts` | 8.x / 13 |
| 2 | Opaque, random, server-side sessions; only the token **hash** is stored | Done | `server/src/auth/session.ts` | 8.x / 13 |
| 3 | Session cookie is `HttpOnly` + `SameSite`; `Secure` outside local dev | Done | `server/src/routes/authRoutes.ts`, `config.ts` (`secureCookies`) | 10.1 |
| 4 | CSRF double-submit protection on state-changing requests | Done | `server/src/auth/csrf.ts`, wired in `server.ts` | 10.1 |
| 5 | Minimal Content-Security-Policy + `nosniff` / `X-Frame-Options: DENY` / `Referrer-Policy` | Done | `server/src/http/securityHeaders.ts` | 10.1 |
| 6 | Output encoding for user-authored text; stored HTML is never rendered | Done | React escaping + `pre-wrap` rendering (frontend) | 10.1 / 13 |
| 7 | Default-deny, server-side authorisation on every request (programme/team/role) | Done | `server/src/auth/authorization.ts`, `httpAuth.ts` | 8.x / 13 |
| 8 | Account status + assignments re-validated on every authenticated request | Done | `server.ts` auth hook + service guards | 8.x / 13 |
| 9 | Log hygiene: no passwords, session tokens/cookies or free-text update content in logs | Done | `server/src/http/logger.ts` (+ tests) | 10.2 |
| 10 | Rate limiting on login & registration (blunts credential stuffing / spam) | Done | `server/src/auth/rateLimiter.ts` | 10.3 |
| 11 | Generic responses that avoid account / programme-data enumeration (login, registration, export) | Done | auth & export routes | 10.3 |
| 12 | Parameterised / server-constructed datastore queries (no raw-input query building) | Done | `server/src/repository/mongoDocumentRepository.ts` | 13 |
| 13 | Atomic submit + append-only audit; submitted versions immutable to app users | Done | `server/src/services/submitService.ts`, repository transactions | 7.5 / 14 |
| 14 | No silent data loss: failed save / conflict / network drop keeps unsaved content for retry | Done | verified in task 10.4 | 10.4 |
| 15 | Audit access separated from general application logs | Done | audit collection + Admin/Auditor-only `GET /audit` | 13 |
| 16 | Local-HTTP dev preserved (Secure cookies + HTTPS-only controls stay off locally) | Done | `config.ts`, `securityHeaders.ts` | 10.1 |

## Residual risks accepted for the local PoC

These are **knowingly accepted** because the PoC is local/internal. Each is
closed or revisited in Phase B before any production exposure.

- **No transport encryption locally.** The PoC runs over plain HTTP; there is no
  HSTS and `Secure` cookies are off in local dev. Acceptable on a trusted local
  machine/network only. → Phase B: TLS termination + HSTS + `Secure` cookies on.
- **Local authentication, not enterprise SSO.** Authentication is local-account
  based (OIDC deferred). No MFA, no enterprise password policy/rotation, no
  centralised account lifecycle. → Phase B: enterprise OIDC.
- **In-memory rate limiting.** The limiter is per-process; it does not coordinate
  across multiple instances and resets on restart. Adequate for a single local
  instance. → Phase B: shared/distributed limiter.
- **Development datastore.** Runs against a local single-node Mongo replica set
  with no at-rest encryption, backup, or platform access controls. → Phase B:
  production database with approved encryption/backup/retention.
- **Observability is log-derived only.** Latency/error counters are parsed from
  the structured logs (see `docs/observability/`); there is no alerting,
  dashboards, tracing or retention policy. → Phase B: enterprise observability.
- **No secrets manager.** Config comes from env/`.env`; there is no managed
  secret store or rotation. → Phase B: platform secrets management.
- **Benchmark is local-scale.** Readiness evidence covers 8 teams + a 2x growth
  margin (16 teams) on local hardware — not the 200-team / 24-month production
  target. → Phase B: production-scale load testing.

## Explicitly deferred to Phase B (production hardening)

- Production-scale load/performance testing (200 teams, 24 months of history).
- Enterprise observability platform (metrics, tracing, dashboards, alerting, retention).
- Formal penetration testing.
- Full enterprise threat model and security approval / sign-off.
- Enterprise OIDC, production database, and production hosting decisions (task 0.2).
- Encryption in transit and at rest via approved platform controls; secrets management.
- Edge/Firefox browser certification (see `docs/accessibility/poc-ui-checks.md`).

## Verification pointers

- Log hygiene: `server/src/http/logger.test.ts` (secrets never reach the log stream).
- Auth/authorisation: `server/src/auth/*.test.ts` (default-deny, CSRF, rate limiting, sessions).
- Abuse/enumeration: covered by task 10.3 tests (generic login/registration/export responses).
- Latency/error counters: `server/src/http/logMetrics.test.ts` + `docs/observability/poc-benchmark-results.md`.
- Draft recovery / no data loss: task 10.4 tests.
