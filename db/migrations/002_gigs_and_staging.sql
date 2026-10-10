-- migrate:up
CREATE TABLE gigs (
  id                    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  source_id             BIGINT UNSIGNED NOT NULL,
  campaign_id           BIGINT UNSIGNED NULL,
  first_run_id          BIGINT UNSIGNED NULL,
  last_run_id           BIGINT UNSIGNED NULL,

  -- identity / dedup keys
  external_gig_id       VARCHAR(191) NULL,
  origin_url            VARCHAR(2048) NOT NULL,
  origin_url_normalized VARCHAR(2048) NOT NULL,            -- canonicalised by app (strip tracking params, fragments, trailing slash)
  origin_url_hash       CHAR(64) GENERATED ALWAYS AS (SHA2(origin_url_normalized, 256)) STORED,
  content_fingerprint   CHAR(64) NULL,                     -- hash of normalised material fields; detects source changes
  duplicate_state       ENUM('none','suspected','confirmed') NOT NULL DEFAULT 'none',
  duplicate_of_gig_id   BIGINT UNSIGNED NULL,

  -- ===== 19-column CSV contract (names match the template exactly) =====
  title                 VARCHAR(255) NULL,
  track_id              CHAR(2) NULL,
  payment_amount        VARCHAR(120) NULL,                 -- human-readable, e.g. "$45 / hr"
  compensation_type     ENUM('hourly','fixed','per_task','monthly','other') NULL,
  min_amount            DECIMAL(12,2) NULL,
  max_amount            DECIMAL(12,2) NULL,
  currency              CHAR(3) NULL,
  priority              INT NOT NULL DEFAULT 0,            -- higher = shown first
  is_featured           TINYINT(1) NOT NULL DEFAULT 0,
  is_local_business     TINYINT(1) NOT NULL DEFAULT 0,
  posted_at             DATE NULL,
  short_description     VARCHAR(500) NULL,
  overview              TEXT NULL,
  responsibilities      TEXT NULL,                         -- items separated by " | "
  deliverables          TEXT NULL,                         -- items separated by " | "
  requirements          TEXT NULL,                         -- items separated by " | "
  proof_spec            TEXT NULL,                         -- items separated by " | "
  -- ===== end of CSV contract =====

  -- extra internal fields
  payment_source_text   VARCHAR(255) NULL,                 -- original wording, never lost when normalising
  posted_at_status      ENUM('found','not_found') NOT NULL DEFAULT 'not_found',
  track_confidence      DECIMAL(4,3) NULL,
  track_set_by          ENUM('rule','ai','human') NULL,
  data_completeness     ENUM('complete','partial','failed') NOT NULL DEFAULT 'partial',
  missing_fields        JSON NULL,
  ai_generated_fields   JSON NULL,                         -- field names whose text was written by AI (vs extracted)
  field_provenance      JSON NULL,                         -- {field: {origin:'extracted|ai|human', evidenceId?}}

  -- workflow
  workflow_state        ENUM('discovered','review_pending','approved','rejected','publish_ready','published','unpublished')
                        NOT NULL DEFAULT 'discovered',
  availability_status   ENUM('active','paused','stopped','needs_review') NOT NULL DEFAULT 'needs_review',
  availability_set_by   ENUM('system','human') NOT NULL DEFAULT 'system',  -- human pin is never silently overridden by a re-check
  verification_confidence DECIMAL(4,3) NULL,
  latest_verification_id BIGINT UNSIGNED NULL,             -- FK added in 003
  last_verified_at      DATETIME(3) NULL,
  approved_by           BIGINT UNSIGNED NULL,
  approved_at           DATETIME(3) NULL,
  pending_source_changes JSON NULL,                        -- diff proposed by re-discovery; never auto-applied to human-edited fields
  current_version       INT UNSIGNED NOT NULL DEFAULT 1,
  first_discovered_at   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  last_seen_at          DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  created_at            DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at            DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (id),
  UNIQUE KEY uq_gigs_source_external (source_id, external_gig_id),   -- DED-01 (NULLs allowed multiple times)
  UNIQUE KEY uq_gigs_url_hash (origin_url_hash),                     -- DED-02
  KEY ix_gigs_review_queue (workflow_state, availability_status, verification_confidence),
  KEY ix_gigs_track (track_id, workflow_state),
  KEY ix_gigs_source (source_id, workflow_state),
  KEY ix_gigs_public (workflow_state, availability_status, priority, posted_at),
  KEY ix_gigs_fingerprint (content_fingerprint),
  KEY ix_gigs_last_verified (last_verified_at),
  FULLTEXT KEY ft_gigs_search (title, short_description),

  CONSTRAINT fk_gigs_source    FOREIGN KEY (source_id)   REFERENCES sources(id),
  CONSTRAINT fk_gigs_campaign  FOREIGN KEY (campaign_id) REFERENCES campaigns(id),
  CONSTRAINT fk_gigs_first_run FOREIGN KEY (first_run_id) REFERENCES discovery_runs(id),
  CONSTRAINT fk_gigs_last_run  FOREIGN KEY (last_run_id)  REFERENCES discovery_runs(id),
  CONSTRAINT fk_gigs_track     FOREIGN KEY (track_id)    REFERENCES modules(id),
  CONSTRAINT fk_gigs_dup_of    FOREIGN KEY (duplicate_of_gig_id) REFERENCES gigs(id),
  CONSTRAINT fk_gigs_approver  FOREIGN KEY (approved_by) REFERENCES users(id),

  CONSTRAINT chk_gigs_amounts   CHECK (min_amount IS NULL OR max_amount IS NULL OR min_amount <= max_amount),
  CONSTRAINT chk_gigs_currency  CHECK (currency IS NULL OR currency REGEXP '^[A-Z]{3}$'),
  CONSTRAINT chk_gigs_conf      CHECK (verification_confidence IS NULL OR (verification_confidence BETWEEN 0 AND 1)),
  CONSTRAINT chk_gigs_trk_conf  CHECK (track_confidence IS NULL OR (track_confidence BETWEEN 0 AND 1)),
  -- PUB-01 defence in depth: approved/publish_ready/published rows must carry an approver
  CONSTRAINT chk_gigs_publish_needs_approval CHECK (
    workflow_state NOT IN ('approved','publish_ready','published') OR approved_by IS NOT NULL
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE gig_versions (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  gig_id         BIGINT UNSIGNED NOT NULL,
  version_no     INT UNSIGNED NOT NULL,
  change_origin  ENUM('discovery','reviewer','csv_import','system') NOT NULL,
  changed_by     BIGINT UNSIGNED NULL,
  changed_fields JSON NULL,
  snapshot       JSON NOT NULL,
  created_at     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_gig_version (gig_id, version_no),
  CONSTRAINT fk_gv_gig  FOREIGN KEY (gig_id)     REFERENCES gigs(id),
  CONSTRAINT fk_gv_user FOREIGN KEY (changed_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE raw_extracts (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  gig_id        BIGINT UNSIGNED NULL,
  run_id        BIGINT UNSIGNED NULL,
  source_id     BIGINT UNSIGNED NOT NULL,
  fetched_url   VARCHAR(2048) NOT NULL,
  final_url     VARCHAR(2048) NULL,
  http_status   SMALLINT UNSIGNED NULL,
  content_type  VARCHAR(120) NULL,
  content_hash  CHAR(64) NULL,
  raw_content   MEDIUMTEXT NULL,                           -- sanitised text/JSON, size-capped, no personal data
  fetched_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  retained_until DATETIME(3) NULL,
  PRIMARY KEY (id),
  KEY ix_raw_gig (gig_id, fetched_at),
  CONSTRAINT fk_raw_gig    FOREIGN KEY (gig_id)    REFERENCES gigs(id),
  CONSTRAINT fk_raw_run    FOREIGN KEY (run_id)    REFERENCES discovery_runs(id),
  CONSTRAINT fk_raw_source FOREIGN KEY (source_id) REFERENCES sources(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE duplicate_candidates (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  gig_id         BIGINT UNSIGNED NOT NULL,
  matched_gig_id BIGINT UNSIGNED NOT NULL,
  match_signal   ENUM('external_id','url','content_similarity') NOT NULL,
  similarity     DECIMAL(5,4) NULL,
  resolution     ENUM('open','confirmed_duplicate','merged','dismissed') NOT NULL DEFAULT 'open',
  resolved_by    BIGINT UNSIGNED NULL,
  resolved_at    DATETIME(3) NULL,
  created_at     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_dup_pair (gig_id, matched_gig_id, match_signal),
  KEY ix_dup_open (resolution),
  CONSTRAINT fk_dup_gig     FOREIGN KEY (gig_id)         REFERENCES gigs(id),
  CONSTRAINT fk_dup_matched FOREIGN KEY (matched_gig_id) REFERENCES gigs(id),
  CONSTRAINT fk_dup_user    FOREIGN KEY (resolved_by)    REFERENCES users(id),
  CONSTRAINT chk_dup_distinct CHECK (gig_id <> matched_gig_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE discovery_errors (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  run_id     BIGINT UNSIGNED NULL,
  source_id  BIGINT UNSIGNED NOT NULL,
  gig_id     BIGINT UNSIGNED NULL,
  stage      ENUM('search','fetch','extract','normalize','classify','verify','dedupe','persist') NOT NULL,
  origin_url VARCHAR(2048) NULL,
  error_code VARCHAR(60) NULL,                             -- e.g. LOGIN_REQUIRED, CAPTCHA, ROBOTS_DISALLOWED, TIMEOUT, PARSE_ERROR
  message    VARCHAR(1000) NOT NULL,
  details    JSON NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_err_run (run_id),
  KEY ix_err_source (source_id, created_at),
  CONSTRAINT fk_err_run    FOREIGN KEY (run_id)    REFERENCES discovery_runs(id),
  CONSTRAINT fk_err_source FOREIGN KEY (source_id) REFERENCES sources(id),
  CONSTRAINT fk_err_gig    FOREIGN KEY (gig_id)    REFERENCES gigs(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- migrate:down
DROP TABLE IF EXISTS discovery_errors;
DROP TABLE IF EXISTS duplicate_candidates;
DROP TABLE IF EXISTS raw_extracts;
DROP TABLE IF EXISTS gig_versions;
DROP TABLE IF EXISTS gigs;
