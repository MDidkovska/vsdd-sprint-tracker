# VSDD Sprint Tracker — Local PoC Backend

A local **proof-of-concept** backend for the VSDD Sprint Tracker: Node.js +
TypeScript + Fastify with a vendor-neutral **MongoDB document adapter**.

> **Proof of concept only.** MongoDB is a PoC choice (design.md §4b) and does
> **not** pre-empt the approved-database decision. Authentication is
> intentionally absent for the PoC; enterprise OIDC is Phase 8. Business API
> endpoints (hierarchy, drafts, submit, leadership, export …) are **not** part
> of this scaffold — they are tasks 7.3–7.11.

## What this scaffold provides (task 7.2a)

- A Fastify server exposing **infrastructure endpoints only**:
  - `GET /health` — liveness (does not touch the database).
  - `GET /ready` — readiness (verifies document-store connectivity; `503` when down).
- A **vendor-neutral document repository** contract
  (`src/repository/documentRepository.ts`) — the persistence boundary the
  domain/API layers depend on. It mirrors the same repository contract used by
  the Phase A mock.
- A **MongoDB adapter** (`src/repository/mongoDocumentRepository.ts`) — the only
  file that knows about MongoDB. It implements the §4a document model:
  - stable, indexable **query envelope** + flexible, versioned **payload**;
  - `schemaVersion` on every document;
  - `revision`/ETag **optimistic-concurrency** guard (a stale revision returns a
    conflict and overwrites nothing);
  - **append-only / immutable** submitted versions and audit events.
- **Docker Compose** for a local MongoDB (`docker-compose.yml`).
- An **environment example** (`.env.example`).
- **Persistence integration tests** that run against an ephemeral MongoDB.

## Layout decision

The backend is a **self-contained package** under `server/`, with its own
`package.json`, `tsconfig.json`, ESLint config (`.eslintrc.cjs`), and Vitest
config. It is wired into the repo as an **npm workspace** (the root
`package.json` declares `"workspaces": ["server"]`), so a single `npm install`
at the repo root installs both the frontend and this package, and a single root
`package-lock.json` manages both — there is no separate lockfile here.

Even though it lives in the same workspace, the backend keeps its own tooling:
the root ESLint config ignores `server/**` and the root Vitest config excludes
`server/**`, so the frontend tools never reach into the backend and vice versa.
Instead, the root `npm run verify` explicitly invokes this package's own verify
(`npm run verify --workspace server`), which runs the backend's lint, typecheck,
tests and production build. That keeps the two build surfaces isolated while
ensuring the repo-root verification covers **both** frontend and backend.

The backend re-declares the domain document shapes (`src/domain/documents.ts`)
to stay structurally identical to the frontend `src/domain/update.ts` and the
`src/api/persistence.ts` model, without coupling the two packages' build
systems.

## Prerequisites

- Node.js 22.12+ (Node 24 LTS is the §4b target).
- Docker + Docker Compose (optional — only needed to run the server against a
  real local MongoDB; the tests do not require it).

## Setup

Install once from the **repository root** (the workspace install covers this
package too):

```bash
npm install            # run at the repo root; installs frontend + server/
cp server/.env.example server/.env   # optional; sensible localhost defaults are built in
```

Backend scripts can then be run either from inside `server/` (e.g. `npm run
dev`) or from the repo root with `npm run <script> --workspace server`.

## Start MongoDB (Docker Compose)

```bash
npm run db:up      # docker compose up -d  (MongoDB on 127.0.0.1:27017, no auth)
npm run db:down    # docker compose down
```

The compose instance runs unauthenticated and is bound to `localhost` only — it
is for local PoC use, never production.

## Run the server

```bash
npm run dev        # tsx watch, loads .env if present
# or, after building:
npm run build && npm start
```

Then probe the infrastructure endpoints:

```bash
curl http://localhost:8080/health   # {"status":"ok",...}
curl http://localhost:8080/ready    # {"status":"ready",...}  (503 if Mongo is down)
```

## Run the persistence integration tests

```bash
npm test
```

By default the tests start an **ephemeral in-process MongoDB**
(`mongodb-memory-server`), so they run without Docker. On the first run the
library downloads a `mongod` binary; later runs reuse the cached binary.

To run the same tests against the Docker Compose MongoDB instead:

```bash
npm run db:up
MONGO_TEST_URI=mongodb://localhost:27017 npm test
```

The tests cover: connect + readiness ping; write a draft and read it back;
revision increments across saves; the optimistic-concurrency guard rejecting a
stale revision without overwriting; concurrent-create conflict; immutable
submitted versions rejecting duplicates; version history ordering; and
append-only audit events.

## Environment variables

See `.env.example`. Summary:

| Variable    | Default                     | Purpose                          |
| ----------- | --------------------------- | -------------------------------- |
| `HOST`      | `0.0.0.0`                   | HTTP bind host                   |
| `PORT`      | `8080`                      | HTTP port                        |
| `MONGO_URI` | `mongodb://localhost:27017` | MongoDB connection URI           |
| `MONGO_DB`  | `vsdd_sprint_tracker`       | Logical database name            |
| `LOG_LEVEL` | `info`                      | Fastify/pino log level           |

`.env` is git-ignored and contains no real secrets.
