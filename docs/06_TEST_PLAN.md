# Test Plan (maps to FRD §28 T01–T15)

Tooling: **Vitest** (unit + integration with a real throw-away MySQL DB), **Fastify `inject()`** for API tests, **msw/nock** for HTTP fixtures, optional Playwright smoke for the back office. LLM calls are mocked with recorded fixtures (deterministic).

| ID | Scenario | Level | Setup (fixture) | Expected result |
|---|---|---|---|---|
| T01 | Valid active gig | integration | page with apply button + "accepting applications", title matches | `active`, confidence ≥ 0.85, evidence rows (open marker) |
| T02 | Closed gig | integration | page "no longer accepting"/410 | `stopped`; publish-readiness fails; `/publish` → 409 |
| T03 | Paused gig | integration | "temporarily paused/waitlist" | `paused`; not treated as active; blocked at gate |
| T04 | Uncertain gig | integration | thin page / conflicting rules vs AI / login wall | `needs_review`, restriction flag stored |
| T05 | Duplicate URL | integration | same URL (with tracking params) twice | 1 gig row (`uq_gigs_url_hash`); run `duplicate_count`=1 |
| T06 | Duplicate external id | integration | same id twice | no second row; version bumped only if content changed |
| T07 | Missing posted date | unit | source without date | `posted_at` NULL, `posted_at_status='not_found'`, CSV cell empty |
| T08 | Missing compensation | unit | no pay info | payment fields NULL; nothing fabricated; AI output containing invented numbers rejected by validator |
| T09 | Wrong module | integration | low-confidence classification | `track_id` NULL → reviewer `POST /reclassify` → saved + `reviews` row |
| T10 | Rejected gig | API | reject then `/publish` | 409; DB CHECK/trigger also blocks direct update |
| T11 | Approved then closed | integration | approve; fixture flips to closed; publish | pre-publish recheck → `stopped`; 409; gig back to `review_pending` |
| T12 | Missing referral | API | source `referral_required=1`, no referral | readiness shows `missingReferral`; publish 409; after human `PUT referral` publish succeeds |
| T13 | CSV export | API | approved dataset | header = 19 columns in exact order; round-trip import→export equal |
| T14 | Source failure | integration | adapter throws / 503 | run `failed`/`partial`, error row logged, existing gigs untouched, source `health=unavailable` |
| T15 | Secrets check | CI script | grep repo + `git ls-files` | no `.env`, no key patterns; `.env.example` has placeholders only |

## Additional tests (beyond FRD minimum)
* **Schema tests**: migrations up→down→up; every CHECK/trigger/unique key (validated manually on MySQL 8.0.46 – see §Validation).
* **Dedup**: similarity flag ≠ auto-merge; human-edited field not overwritten by re-discovery (`pending_source_changes`).
* **AI guard**: AI quote absent from page text is dropped; confidence cap when only AI supports the claim.
* **RBAC**: reviewer cannot publish; publisher cannot approve (unless admin); anonymous cannot hit `/api/v1`.
* **Public API**: unpublished/rejected/stopped gig → 404; paused shows label.
* **Notifications**: published → learner/site events; rejected/stopped → none (NOT-03); failure → admin event (NOT-02).
* **Robots/CAPTCHA**: fixture with disallowed path / CAPTCHA marker is skipped, flagged, never fetched around.
* **Performance**: 200-row sample import + repeat run completes, second run = 0 creations.

## Validation already performed on the delivered schema (MySQL 8.0.46)
Migrations apply, roll back to 0 objects and re-apply. Verified to be rejected by the DB: duplicate external id (T06), duplicate URL (T05), approved state without approver (PUB-01), enabling a source without access method/terms review (SRC-02/04), publishing a non-active gig, learner "published" notification for an unpublished gig (NOT-03), second active referral for a gig, "published" publication without verification proof. Verified to work: happy-path publish, `v_published_gigs`, `v_gig_csv_export` = 19 columns.
