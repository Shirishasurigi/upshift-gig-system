-- migrate:up

-- Public read model: ONLY published gigs that are not stopped. (PUB-05, "Do not expose records that are not approved/published")
CREATE VIEW v_published_gigs AS
SELECT
  g.id,
  g.external_gig_id,
  g.title,
  g.track_id,
  m.name                AS module_name,
  g.availability_status AS status,                         -- 'active' or 'paused' (paused is shown labelled, apply disabled)
  g.payment_amount,
  g.compensation_type,
  g.min_amount,
  g.max_amount,
  g.currency,
  g.priority,
  g.is_featured,
  g.is_local_business,
  g.posted_at,
  g.origin_url,
  COALESCE(CASE WHEN rg.referral_type = 'link' THEN rg.referral_value END,
           CASE WHEN rs.referral_type = 'link' THEN rs.referral_value END,
           g.origin_url) AS application_url,
  COALESCE(CASE WHEN rg.referral_type = 'id' THEN rg.referral_value END,
           CASE WHEN rs.referral_type = 'id' THEN rs.referral_value END) AS referral_code,
  g.short_description,
  g.overview,
  g.responsibilities,
  g.deliverables,
  g.requirements,
  g.proof_spec,
  g.last_verified_at,
  p.published_at
FROM gigs g
JOIN modules m ON m.id = g.track_id
JOIN publications p ON p.gig_id = g.id AND p.status = 'published'
LEFT JOIN referrals rg ON rg.gig_id = g.id AND rg.is_active = 1
LEFT JOIN referrals rs ON rs.source_id = g.source_id AND rs.is_active = 1
WHERE g.workflow_state = 'published'
  AND g.availability_status IN ('active','paused');

-- CSV contract view: EXACTLY the 19 template columns, in template order.
-- Scope = human-approved dataset (T13). The API adds other scopes/filters on the gigs table directly.
CREATE VIEW v_gig_csv_export AS
SELECT
  g.external_gig_id,
  g.title,
  g.track_id,
  g.payment_amount,
  g.compensation_type,
  g.min_amount,
  g.max_amount,
  g.currency,
  g.priority,
  g.is_featured,
  g.is_local_business,
  g.posted_at,
  g.origin_url,
  g.short_description,
  g.overview,
  g.responsibilities,
  g.deliverables,
  g.requirements,
  g.proof_spec
FROM gigs g
WHERE g.workflow_state IN ('approved','publish_ready','published');

-- migrate:down
DROP VIEW IF EXISTS v_gig_csv_export;
DROP VIEW IF EXISTS v_published_gigs;
