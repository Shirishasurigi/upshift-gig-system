# UpShift – AI-Powered Gig Discovery, Verification & Publishing System

Independent, standalone system (own repo, own MySQL database, own API, own review UI).
**No UpShift production database, keys, code or infrastructure is used or required.**

> Discovery is automated. Verification is evidence-based. **Publishing is always a human decision.**

## 1. Tech stack (fixed)

| Layer | Technology |
|---|---|
| End-user website | Next.js (SSG/ISR) on Node.js |
| Back office (review UI) | Vite + React + TypeScript (static deployment) |
| Backend / API + worker | Node.js 20+ · Fastify · TypeScript |
| Database | MySQL 8.0+ (InnoDB, utf8mb4) |
| Tooling | npm workspaces, Git/GitHub, REST/JSON, Vitest |

## 2. Repository layout

```
upshift-gig-system/
├─ apps/
│  ├─ api/            Fastify API + in-process worker (discovery, verification, publishing, notifications)
│  ├─ backoffice/     Vite + React review dashboard (static build)
│  └─ website/        Next.js public Opportunities page (SSG/ISR)
├─ packages/
│  └─ shared/         TypeScript types, zod schemas, CSV column contract, enums
├─ db/
│  └─ migrations/     001…009 versioned SQL (-- migrate:up / -- migrate:down)
├─ data/sample/       Supplied sample dataset (100–200 gigs) + CSV template
├─ docs/              Architecture, ERD, API, CSV contract, test plan, limitations
├─ .env.example
└─ README.md
```

## 3. Prerequisites
Node.js ≥ 20, npm ≥ 10, MySQL ≥ 8.0.16 (CHECK constraints are enforced from this version), Git.
Your DB user needs `CREATE, ALTER, INDEX, REFERENCES, TRIGGER, CREATE VIEW` on the project database
(if binary logging is on: `SET GLOBAL log_bin_trust_function_creators = 1` or SUPER).

## 4. Setup (fresh machine)

```bash
git clone <your-repo-url> upshift-gig-system && cd upshift-gig-system
npm install

cp .env.example .env            # fill in YOUR dev values; never commit .env

# create database + user (once)
mysql -u root -p -e "CREATE DATABASE upshift_gigs_dev CHARACTER SET utf8mb4;
  CREATE USER 'upshift_gigs'@'%' IDENTIFIED BY 'change-me';
  GRANT ALL ON upshift_gigs_dev.* TO 'upshift_gigs'@'%';"

npm run db:migrate              # applies db/migrations/*.sql in order, tracked in schema_migrations
npm run db:seed:admin           # creates first admin from SEED_ADMIN_* env vars
npm run sample:load             # imports data/sample/*.csv via the SAMPLE_CSV source (full pipeline)

npm run dev:api                 # http://localhost:4000   (Swagger UI at /docs)
npm run dev:backoffice          # http://localhost:5173
npm run dev:website             # http://localhost:3000
```

> The npm script names above are the **contract** the implementation must provide (they are part of the Definition of Done).

### Useful commands
| Command | Purpose |
|---|---|
| `npm run db:migrate` / `db:rollback` / `db:status` | Apply / revert last / list migrations |
| `npm run db:reset` | Drop → create → migrate → seed (dev only) |
| `npm test` | Unit + integration tests (needs a throw-away MySQL DB, see `.env.test`) |
| `npm run export:csv -- --scope=approved` | Writes the 19-column CSV |
| `npm run build` | Builds API, back office (static) and website |

## 5. Using the system (demo path)
1. **Sources** (back office → Sources): `SAMPLE_CSV` is enabled. Mercor / Mindrift / Fiverr are placeholders: they **cannot** be enabled until an access method and a terms review are recorded (enforced by a DB constraint).
2. **Run discovery** on `SAMPLE_CSV` → candidates are extracted, normalised, classified (M1–M6 or "manual"), verified, de-duplicated and land in **Review Pending**.
3. **Review**: open a gig → inspect source link, evidence, confidence → edit / reclassify → **Approve**, **Reject**, **Pause** or **Stop**.
4. **Referral**: a human enters the referral ID/link (mandatory per source if configured). The system never creates third-party accounts.
5. **Publish** (publisher role): system re-verifies immediately; if still valid and all required fields exist → published, ISR revalidated, notification event created.
6. **Export**: `GET /api/v1/csv/export?scope=approved` → exact 19-column template.
7. **Health sweep** keeps checking published gigs; a gig that becomes Stopped is automatically unpublished.

## 6. Database
* Schema/ERD: `docs/03_ERD.md` · Migrations: `db/migrations/` (fresh DB is fully rebuildable).
* **Backup:** `mysqldump --single-transaction --routines --triggers -u <user> -p upshift_gigs_dev > backup.sql`
* **Restore:** `mysql -u <user> -p -e "DROP DATABASE IF EXISTS upshift_gigs_dev; CREATE DATABASE upshift_gigs_dev CHARACTER SET utf8mb4;" && mysql -u <user> -p upshift_gigs_dev < backup.sql`
* Or rebuild from scratch: `npm run db:reset && npm run sample:load`.

## 7. Security & compliance
* Secrets only via environment variables; `.env` is git-ignored; CI/test T15 greps the repo for secrets.
* Passwords hashed (argon2/bcrypt); JWT in httpOnly cookie; role-based access (admin / reviewer / publisher).
* Discovery honours robots.txt, rate limits, login/CAPTCHA/paywall walls (skip + log, never bypass).
* Back office bundle contains **no** secrets (only `VITE_API_BASE_URL`).

## 8. Documentation index
`docs/01_LEAD_BRIEFING.md` · `02_ARCHITECTURE.md` · `03_ERD.md` · `04_API.md` · `05_CSV_CONTRACT.md` · `06_TEST_PLAN.md` · `07_KNOWN_LIMITATIONS.md`

## 9. Deployment
* API/worker + website: Node.js processes (e.g. PM2/systemd/container). Back office: `npm run build -w apps/backoffice` → static files on any static host. MySQL: managed or self-hosted 8.x.
