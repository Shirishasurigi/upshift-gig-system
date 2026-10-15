# UpShift — AI-Powered Gig Discovery, Verification & Publishing System

An independent gig discovery and review system with its own API, MySQL database, and review interface.

> Discovery is automated. Verification is evidence-based. Publishing remains a human decision.

## 1. Technology stack

| Layer | Technology |
|---|---|
| API and worker | Node.js, Fastify, TypeScript |
| Back office | Vite, React, TypeScript |
| Public website | Next.js |
| Database | MySQL 8+ |
| Package management | npm workspaces |
| Testing | Vitest for back-office tests |

## 2. Repository structure

- `apps/api/` — API endpoints and discovery, verification, classification, review, and publishing logic.
- `apps/backoffice/` — review dashboard.
- `apps/website/` — public website.
- `packages/shared/` — shared contracts and types, where applicable.
- `db/migrations/` — database migration files.
- `data/sample/` — sample data and CSV resources.
- `docs/` — architecture, ERD, API, CSV contract, testing, and demo documentation.
- `.env.example` — example environment configuration.
- `.env` — local configuration; do not commit it.

## 3. Prerequisites

Install the required versions of Node.js, npm, and MySQL for this project. The intended database baseline is MySQL 8 or newer.

Configure local environment variables using `.env.example`. Use development credentials only and never publish passwords, tokens, or other secrets.

## 4. Start the applications

Run commands from the repository root in separate PowerShell terminals.

### API

```powershell
npm run dev:api
```

### Back office

```powershell
npm run dev:backoffice
```

### Public website

```powershell
npm run dev:website
```

Use the local URLs printed by each development server. Typical configured ports are API `4000`, back office `5173`, and website `3000`; confirm the actual output.

The API health endpoint is:

`http://localhost:4000/health`

The API documentation may be available at `/docs` if enabled by the current server configuration.

## 5. Available package scripts

The following root scripts were verified in `package.json`:

| Command | Purpose |
|---|---|
| `npm run dev:api` | Start the API development server |
| `npm run dev:backoffice` | Start the back-office development server |
| `npm run dev:website` | Start the website development server |
| `npm run build:website` | Build the website |

Additional workspace scripts can be inspected in the relevant `apps/*/package.json` files. Do not assume a root script exists unless it is defined in the root `package.json`.

## 6. Demo workflow

1. Check API and database health.
2. Review the configured discovery sources.
3. Explain how discovery gathers and normalises gig candidates.
4. Inspect verification status and supporting evidence.
5. Review a candidate and demonstrate available human review actions.
6. Explain referral requirements where applicable.
7. Demonstrate publication readiness and the pre-publish verification gate using an appropriate existing record.
8. Explain the 19-column CSV contract.
9. Explain how health checks can detect gigs that are no longer active.

See `docs/08_DEMO_GUIDE.md` for the detailed walkthrough.

Do not run migrations, imports, discovery pipelines, seed commands, or database resets against the current development database during a demo unless their effects are understood and explicitly approved.

## 7. Security

- Keep `.env` and credentials out of version control.
- Use authorised demo accounts and avoid displaying secrets or personal data.
- Respect source access requirements and website restrictions.
- Treat review and publication as controlled, human-authorised actions.
- Test database-changing workflows against an isolated test database whenever possible.

## 8. Documentation index

- `docs/02_ARCHITECTURE.md` — system architecture.
- `docs/03_ERD.md` — database entity-relationship documentation.
- `docs/04_API.md` — API documentation.
- `docs/05_CSV_CONTRACT.md` — CSV contract.
- `docs/06_TEST_PLAN.md` — acceptance test plan mapped to FRD scenarios.
- `docs/07_TEST_EXECUTION_RECORD.md` — observed test results and outstanding checks.
- `docs/08_DEMO_GUIDE.md` — demo preparation and walkthrough.

## 9. Testing status

The recorded checks include 33 passing back-office tests, a successful API TypeScript check, and a successful API health/database connectivity check.

**Overall acceptance status: Partially Verified.** Several FRD acceptance scenarios still require end-to-end testing. See `docs/06_TEST_PLAN.md` and `docs/07_TEST_EXECUTION_RECORD.md`. Do not interpret unrun scenarios as passed.

## 10. Database safety

Database migrations, CSV imports, discovery pipelines, seed commands, and reset operations may change data. Review the relevant command implementation and use a disposable test database before running destructive or data-changing tests.

For database design and API details, consult `docs/03_ERD.md` and `docs/04_API.md`.
