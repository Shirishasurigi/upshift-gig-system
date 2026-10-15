# UpShift Gig System — Demo Guide

## Purpose
Demonstrate the existing gig discovery, verification, human review, and publishing workflow.

## Before the demo
- Confirm the API and MySQL are running.
- Confirm the backoffice can connect to the API.
- Use existing sample data and an authorised demo account.
- Do not run migrations, database resets, CSV imports, or discovery pipelines during the demo unless the dataset and side effects have been checked first.
- Do not display passwords, tokens, private environment values, or real user data.

## Start the applications
Open separate PowerShell terminals in the project root.

Terminal 1 — API:
```powershell
npm run dev:api
```

Terminal 2 — Backoffice:
```powershell
npm run dev:backoffice
```

Terminal 3 — Website, if demonstrating it:
```powershell
npm run dev:website
```

Open the local URLs printed by the development servers. The README documents the usual ports as API 4000, backoffice 5173, and website 3000; verify the actual terminal output.

## Demo walkthrough

1. **System health:** Show that the API health endpoint responds and the database connection is healthy.
2. **Sources:** Show configured sources. Explain that sources require appropriate access-method and terms-review checks before activation.
3. **Discovery:** Explain how a discovery run gathers and normalises candidate gigs. Only start a run if its effects on the current database are understood and approved.
4. **Verification:** Show verification status and evidence used to decide whether a listing is active, stopped, paused, or needs review.
5. **Human review:** Open a candidate, inspect its source and evidence, and demonstrate available review actions using a suitable existing record.
6. **Referral:** Explain that a human supplies referral details when the source requires them.
7. **Publishing:** Explain that publishing requires authorisation, approval, required fields, and a successful pre-publish verification.
8. **CSV:** Explain the 19-column CSV contract. Do not import data during the presentation unless using an approved disposable dataset.
9. **Health sweep:** Explain how published gigs are checked again and may be unpublished if they are no longer active.

## Suggested closing
The system automates discovery and assists verification, while retaining human control over approval and publication. It records evidence and workflow decisions to support review and traceability.

## Known demo limitations
- API end-to-end acceptance scenarios are not fully verified; see `06_TEST_PLAN.md` and `07_TEST_EXECUTION_RECORD.md`.
- Backoffice tests passed 33/33, and the API TypeScript check passed in the recorded checks.
- Do not claim untested workflows have passed.
