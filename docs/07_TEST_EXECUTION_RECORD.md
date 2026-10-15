# Block 3.4 — Test Execution Record

## Scope
Acceptance testing mapped to FRD Section 28 (T01–T15).

## Results observed

| Check | Result | Evidence / limitation |
|---|---|---|
| Backoffice automated tests | PASS | 33 tests passed |
| API TypeScript check | PASS | `npx tsc --noEmit -p .\apps\api\tsconfig.json` completed without errors |
| API health | PASS | `/health` returned status `ok`; MySQL reported version 8.4.11 |
| Database connectivity | PASS | Read-only database connectivity check succeeded |
| Anonymous authentication guard | PASS | `/api/v1/auth/me` returned HTTP 401 |
| Anonymous gigs endpoint guard | PASS | `/api/v1/gigs` returned HTTP 401 |
| CSV fixture headers | PASS | Three sample CSV files had the expected 19 columns in the expected order |
| CSV template endpoint | PARTIAL | Anonymous request returned HTTP 401; template content was not verified |
| Secret scan | PARTIAL | Selected tracked-file patterns checked; this was not a complete history or secret-format audit |

## FRD acceptance scenarios

| ID | Status | Outstanding evidence |
|---|---|---|
| T01 | NOT RUN | Active gig verification and evidence |
| T02 | NOT RUN | Closed gig blocked from publication |
| T03 | NOT RUN | Paused gig remains non-active |
| T04 | NOT RUN | Uncertain gig and restriction handling |
| T05 | NOT RUN | Duplicate URL integration behaviour |
| T06 | NOT RUN | Duplicate external ID integration behaviour |
| T07 | PARTIAL | Date parsing checked; complete persistence and export scenario not verified |
| T08 | PARTIAL | Missing/invalid money parsing checked; complete acceptance scenario not verified |
| T09 | PARTIAL | UI review coverage exists; persisted reclassification and audit evidence not verified |
| T10 | PARTIAL | UI coverage exists; rejected-gig API publication block not verified end-to-end |
| T11 | NOT RUN | Approved gig closed before publication |
| T12 | PARTIAL | UI referral coverage exists; full API publication gate not verified |
| T13 | PARTIAL | Fixture headers checked; live export and round-trip not verified |
| T14 | PARTIAL | UI failure coverage is limited; controlled source-failure integration test not run |
| T15 | PARTIAL | Selected secret scan only; complete audit not run |

## Limitations
- The API package has no discovered API test files or test script.
- Backoffice tests use mocked API responses and do not independently prove database/API acceptance scenarios.
- End-to-end scenarios requiring authenticated users or database records remain unverified.
- Do not run imports, pipelines, migrations, seed commands, or other database-mutating tests against the development database without explicit approval.

## Overall outcome
**PARTIALLY VERIFIED.** The checks listed as PASS have observed evidence. Partial and not-run scenarios must not be represented as passed.

## Next steps
1. Run remaining integration/API acceptance scenarios against an isolated disposable test database.
2. Record actual results and evidence for each T01–T15 scenario.
3. Repeat the secret scan using the agreed project security checklist.
