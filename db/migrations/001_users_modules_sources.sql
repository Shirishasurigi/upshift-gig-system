-- migrate:up
CREATE TABLE users (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  email         VARCHAR(255)    NOT NULL,
  display_name  VARCHAR(120)    NOT NULL,
  password_hash VARCHAR(255)    NOT NULL,
  role          ENUM('admin','reviewer','publisher') NOT NULL,
  is_active     TINYINT(1)      NOT NULL DEFAULT 1,
  last_login_at DATETIME(3)     NULL,
  created_at    DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at    DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE modules (
  id              CHAR(2)      NOT NULL,                -- 'M1'..'M6'
  name            VARCHAR(100) NOT NULL,
  description     VARCHAR(500) NULL,
  search_keywords JSON         NULL,
  display_order   TINYINT UNSIGNED NOT NULL DEFAULT 0,
  is_active       TINYINT(1)   NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  CONSTRAINT chk_modules_id CHECK (id REGEXP '^M[1-6]$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE sources (
  id                     BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code                   VARCHAR(40)  NOT NULL,
  name                   VARCHAR(120) NOT NULL,
  base_url               VARCHAR(2048) NULL,
  access_method          ENUM('official_api','public_feed','public_page_search','permitted_crawl','csv_import','manual_entry','undetermined')
                         NOT NULL DEFAULT 'undetermined',
  access_method_notes    TEXT NULL,
  terms_url              VARCHAR(2048) NULL,
  terms_reviewed_at      DATETIME(3) NULL,
  terms_reviewed_by      BIGINT UNSIGNED NULL,
  robots_respected       TINYINT(1) NOT NULL DEFAULT 1,
  rate_limit_per_minute  SMALLINT UNSIGNED NOT NULL DEFAULT 10,
  adapter_key            VARCHAR(60) NULL,              -- maps to a source adapter module in code
  config                 JSON NULL,
  enablement             ENUM('enabled','disabled','unsupported') NOT NULL DEFAULT 'disabled',
  health                 ENUM('unknown','healthy','degraded','unavailable') NOT NULL DEFAULT 'unknown',
  health_message         VARCHAR(500) NULL,
  last_health_check_at   DATETIME(3) NULL,
  last_successful_run_at DATETIME(3) NULL,
  referral_required      TINYINT(1) NOT NULL DEFAULT 0, -- REF-03: mandatory referral => block publish if missing
  created_at             DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at             DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_sources_code (code),
  KEY ix_sources_enablement (enablement, health),
  CONSTRAINT fk_sources_terms_reviewer FOREIGN KEY (terms_reviewed_by) REFERENCES users(id),
  -- SRC-02 / SRC-04: a source cannot be enabled until a permitted access method is documented and terms reviewed
  CONSTRAINT chk_sources_enable_requires_review CHECK (
    enablement <> 'enabled' OR (access_method <> 'undetermined' AND terms_reviewed_at IS NOT NULL)
  ),
  CONSTRAINT chk_sources_robots CHECK (robots_respected = 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE campaigns (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  source_id       BIGINT UNSIGNED NOT NULL,
  name            VARCHAR(160) NOT NULL,
  module_id       CHAR(2) NULL,                         -- optional focus module
  search_criteria JSON NULL,                            -- keywords, filters, page limits
  schedule_cron   VARCHAR(60) NULL,
  is_active       TINYINT(1) NOT NULL DEFAULT 1,
  created_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_campaign_source_name (source_id, name),
  CONSTRAINT fk_campaigns_source FOREIGN KEY (source_id) REFERENCES sources(id),
  CONSTRAINT fk_campaigns_module FOREIGN KEY (module_id) REFERENCES modules(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE discovery_runs (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  source_id       BIGINT UNSIGNED NOT NULL,
  campaign_id     BIGINT UNSIGNED NULL,
  trigger_type    ENUM('manual','scheduled','csv_import','api') NOT NULL,
  status          ENUM('queued','running','succeeded','partial','failed','cancelled') NOT NULL DEFAULT 'queued',
  started_at      DATETIME(3) NULL,
  finished_at     DATETIME(3) NULL,
  found_count     INT UNSIGNED NOT NULL DEFAULT 0,
  created_count   INT UNSIGNED NOT NULL DEFAULT 0,
  updated_count   INT UNSIGNED NOT NULL DEFAULT 0,
  unchanged_count INT UNSIGNED NOT NULL DEFAULT 0,
  duplicate_count INT UNSIGNED NOT NULL DEFAULT 0,
  failed_count    INT UNSIGNED NOT NULL DEFAULT 0,
  error_summary   TEXT NULL,
  initiated_by    BIGINT UNSIGNED NULL,
  created_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_runs_source_status (source_id, status, created_at),
  CONSTRAINT fk_runs_source   FOREIGN KEY (source_id)    REFERENCES sources(id),
  CONSTRAINT fk_runs_campaign FOREIGN KEY (campaign_id)  REFERENCES campaigns(id),
  CONSTRAINT fk_runs_user     FOREIGN KEY (initiated_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- migrate:down
DROP TABLE IF EXISTS discovery_runs;
DROP TABLE IF EXISTS campaigns;
DROP TABLE IF EXISTS sources;
DROP TABLE IF EXISTS modules;
DROP TABLE IF EXISTS users;
