# API Contract (REST / JSON) – Fastify

Base: `/api/v1` (authenticated, cookie JWT) · `/public/v1` (anonymous, read-only, rate-limited).
Docs are also generated at runtime by `@fastify/swagger` → `/docs` (OpenAPI 3 from zod schemas).
Roles: **A**dmin, **R**eviewer, **P**ublisher (admin can do everything).

**Conventions** – pagination `?page=1&pageSize=25` → `{data:[], page, pageSize, total}`; errors `{error:{code,message,details?}}` with 400/401/403/404/409/422; long operations return `202 {jobId, …}`; every mutating call writes `audit_log` with actor + `request_id`.

## Auth
| Method | Path | Role | Notes |
|---|---|---|---|
| POST | /auth/login | – | `{email,password}` → sets httpOnly cookie |
| POST | /auth/logout | any | |
| GET | /auth/me | any | user + role |

## Sources & campaigns (SRC-01…05)
| Method | Path | Role | Notes |
|---|---|---|---|
| GET | /sources | any | with health, enablement, last run |
| POST | /sources | A | create (starts `disabled`) |
| PATCH | /sources/:id | A | enabling requires `accessMethod≠undetermined` and `termsReviewedAt` (409 otherwise) |
| POST | /sources/:id/health-check | A | records `health` + message |
| GET/POST | /sources/:id/campaigns | A/R | |
| PATCH | /campaigns/:id | A | criteria, schedule, active |

## Discovery (DISC-01…07)
| Method | Path | Role | Notes |
|---|---|---|---|
| POST | /discovery/runs | A,R | `{sourceId,campaignId?}` → `202 {runId}`; 409 if source not enabled/healthy |
| GET | /discovery/runs | any | filter `sourceId,status` |
| GET | /discovery/runs/:id | any | counts: found/created/updated/unchanged/duplicate/failed, status `succeeded|partial|failed` |
| GET | /discovery/runs/:id/errors | any | stage, error_code, url, message |

## Gigs / review queue (REV-01…08)
| Method | Path | Role | Notes |
|---|---|---|---|
| GET | /gigs | any | filters: `workflowState, availability, track, sourceId, confidenceMin, confidenceMax, duplicate, completeness, q, sort` – default queue = `review_pending` ordered by confidence asc |
| GET | /gigs/:id | any | full record + latest verification + referral + flags (`missingReferral`, `pendingSourceChanges`, `duplicateOpen`) |
| PATCH | /gigs/:id | R | edit any content field; sends `{changes, note?}`; saved as new version; field marked `human` in provenance |
| GET | /gigs/:id/versions | any | |
| GET | /gigs/:id/verifications | any | history of checks |
| GET | /verifications/:id/evidence | any | evidence rows (REV-08) |
| GET | /gigs/:id/history | any | merged reviews + audit + referral changes |
| POST | /gigs/:id/verify | R | manual re-verify → `202` |
| POST | /gigs/:id/reclassify | R | `{trackId}` (T09) |
| POST | /gigs/:id/approve | R | requires latest verification not `stopped`; sets approver/time |
| POST | /gigs/:id/reject | R | `{note}` required; never publishable |
| POST | /gigs/:id/pause · /stop | R | sets availability (human-pinned) |
| POST | /gigs/:id/reopen | R | back to `review_pending` |
| PUT | /gigs/:id/referral | R,P | `{type:'id'|'link', value}`; history row written (REF-04) |
| GET | /gigs/:id/duplicates | any | |
| POST | /duplicates/:id/resolve | R | `confirmed_duplicate | merged | dismissed` |

## Publishing (PUB-01…05)
| Method | Path | Role | Notes |
|---|---|---|---|
| GET | /gigs/:id/publish-readiness | R,P | returns checklist `[{rule, ok, message}]` – approval, status, required fields, referral, duplicates, recency |
| POST | /gigs/:id/publish | P | runs **pre-publish verification now**; `201` with publication, or `409 {blockedBy:[…]}` and gig returned to `review_pending` if stale/closed/changed |
| POST | /gigs/:id/unpublish | P | `{reason}` |
| GET | /publications | any | |

## Notifications (NOT-01…03)
| Method | Path | Role | Notes |
|---|---|---|---|
| GET | /notifications | A,P | filter `status,type,audience`; failures surfaced here and on the dashboard |
| POST | /notifications/:id/retry | A | |

## CSV (Sec. 18)
| Method | Path | Role | Notes |
|---|---|---|---|
| GET | /csv/template | any | header-only file |
| POST | /csv/import?dryRun=true\|false | A,R | multipart; per-row validation; upsert by `(source, external_gig_id)` then URL; result `{jobId, created, updated, skipped, failed, errors[{row,field,message}]}` |
| GET | /csv/export?scope=approved\|published\|all&track=&sourceId= | A,R,P | **exactly 19 columns**, UTF-8, RFC-4180 |
| GET | /csv/jobs · /csv/jobs/:id | A,R | |

## Operations
| Method | Path | Role | Notes |
|---|---|---|---|
| GET | /logs/errors | A,R | discovery/verification/publish failures |
| GET | /audit | A | filter `entityType, entityId, actor` |
| GET/POST/PATCH | /users | A | |
| GET/PUT | /settings | A | thresholds in `settings` table |
| GET | /health | – | liveness + DB ping |

## Public read API (Opportunities page, SSG/ISR)
| Method | Path | Notes |
|---|---|---|
| GET | /public/v1/gigs | `q` (FULLTEXT), `track`, `status` (`active|paused`), `compensationType`, `featured`, `localBusiness`, `sort=priority\|posted\|amount`, paging. Reads `v_published_gigs` only. |
| GET | /public/v1/gigs/:id | 404 for anything not published |
| GET | /public/v1/modules | M1–M6 |

Response item: `id, title, track, moduleName, status, paymentAmount, compensationType, minAmount, maxAmount, currency, priority, isFeatured, isLocalBusiness, postedAt, originUrl, applicationUrl, referralCode, shortDescription, overview, responsibilities[], deliverables[], requirements[], proofSpec[], lastVerifiedAt`. Paused gigs are labelled and carry no active apply action; Stopped never appears.

## Internal contract: website revalidation
API → `POST {WEBSITE_REVALIDATE_URL}` with header `x-revalidate-secret` and `{paths:[…]}` after publish/unpublish (audience = `site`).
