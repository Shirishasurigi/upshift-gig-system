-- migrate:up
CREATE TABLE verifications (
  id                      BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  gig_id                  BIGINT UNSIGNED NOT NULL,
  run_id                  BIGINT UNSIGNED NULL,
  trigger_type            ENUM('discovery','scheduled_health','manual','pre_publish') NOT NULL,
  checked_at              DATETIME(3) NOT NULL,
  url_reachable           TINYINT(1) NULL,
  http_status             SMALLINT UNSIGNED NULL,
  final_url               VARCHAR(2048) NULL,
  access_restriction      ENUM('none','login_required','captcha','paywall','robots_disallowed','rate_limited') NOT NULL DEFAULT 'none',
  page_matches_opportunity TINYINT(1) NULL,                -- VER-02
  availability_signal     ENUM('open','closed','paused','unclear') NOT NULL DEFAULT 'unclear',  -- VER-03
  result_status           ENUM('active','paused','stopped','needs_review') NOT NULL,
  confidence              DECIMAL(4,3) NOT NULL,           -- VER-06
  reasons                 JSON NULL,
  ai_model                VARCHAR(80) NULL,
  ai_summary              TEXT NULL,                       -- clearly separated from extracted facts
  outcome                 ENUM('completed','error') NOT NULL DEFAULT 'completed',
  error_message           VARCHAR(1000) NULL,
  duration_ms             INT UNSIGNED NULL,
  created_at              DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_ver_gig (gig_id, checked_at),
  KEY ix_ver_trigger (trigger_type, checked_at),
  CONSTRAINT fk_ver_gig FOREIGN KEY (gig_id) REFERENCES gigs(id),
  CONSTRAINT fk_ver_run FOREIGN KEY (run_id) REFERENCES discovery_runs(id),
  CONSTRAINT chk_ver_conf CHECK (confidence BETWEEN 0 AND 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE verification_evidence (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  verification_id BIGINT UNSIGNED NOT NULL,
  gig_id          BIGINT UNSIGNED NOT NULL,
  evidence_type   ENUM('url_check','title_match','availability_marker','closed_marker','paused_marker',
                       'posted_date','compensation','api_field','page_excerpt','ai_assessment') NOT NULL,
  field_name      VARCHAR(60) NULL,
  extracted_value TEXT NULL,
  excerpt         TEXT NULL,                               -- verbatim snippet from the source (must exist in fetched content)
  locator         VARCHAR(500) NULL,                       -- selector / JSON path / offset
  is_ai_generated TINYINT(1) NOT NULL DEFAULT 0,
  confidence      DECIMAL(4,3) NULL,
  created_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_evd_verification (verification_id),
  KEY ix_evd_gig (gig_id, evidence_type),
  CONSTRAINT fk_evd_ver FOREIGN KEY (verification_id) REFERENCES verifications(id),
  CONSTRAINT fk_evd_gig FOREIGN KEY (gig_id)          REFERENCES gigs(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE ai_classifications (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  gig_id            BIGINT UNSIGNED NOT NULL,
  proposed_track_id CHAR(2) NULL,                          -- NULL => model could not decide
  confidence        DECIMAL(4,3) NULL,
  rationale         TEXT NULL,
  alternatives      JSON NULL,
  model             VARCHAR(80) NULL,
  prompt_version    VARCHAR(40) NULL,
  outcome           ENUM('auto_assigned','needs_manual','overridden_by_human') NOT NULL,
  created_at        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_cls_gig (gig_id, created_at),
  CONSTRAINT fk_cls_gig   FOREIGN KEY (gig_id)            REFERENCES gigs(id),
  CONSTRAINT fk_cls_track FOREIGN KEY (proposed_track_id) REFERENCES modules(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

ALTER TABLE gigs
  ADD CONSTRAINT fk_gigs_latest_verification
  FOREIGN KEY (latest_verification_id) REFERENCES verifications(id);

-- migrate:down
ALTER TABLE gigs DROP FOREIGN KEY fk_gigs_latest_verification;
DROP TABLE IF EXISTS ai_classifications;
DROP TABLE IF EXISTS verification_evidence;
DROP TABLE IF EXISTS verifications;
