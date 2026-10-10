-- migrate:up
CREATE TABLE audit_log (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  entity_type   VARCHAR(40) NOT NULL,                      -- gig, source, referral, publication, user, setting ...
  entity_id     BIGINT UNSIGNED NULL,
  action        VARCHAR(60) NOT NULL,
  actor_type    ENUM('user','system','discovery_agent','verification_engine') NOT NULL,
  actor_user_id BIGINT UNSIGNED NULL,
  details       JSON NULL,
  request_id    VARCHAR(64) NULL,
  created_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_audit_entity (entity_type, entity_id, created_at),
  KEY ix_audit_actor (actor_user_id, created_at),
  CONSTRAINT fk_audit_user FOREIGN KEY (actor_user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE settings (
  key_name    VARCHAR(80) NOT NULL,
  value       JSON NOT NULL,
  description VARCHAR(300) NULL,
  updated_by  BIGINT UNSIGNED NULL,
  updated_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (key_name),
  CONSTRAINT fk_settings_user FOREIGN KEY (updated_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE csv_jobs (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  direction       ENUM('import','export') NOT NULL,
  file_name       VARCHAR(255) NULL,
  status          ENUM('running','completed','completed_with_errors','failed') NOT NULL DEFAULT 'running',
  total_rows      INT UNSIGNED NOT NULL DEFAULT 0,
  created_rows    INT UNSIGNED NOT NULL DEFAULT 0,
  updated_rows    INT UNSIGNED NOT NULL DEFAULT 0,
  skipped_rows    INT UNSIGNED NOT NULL DEFAULT 0,
  failed_rows     INT UNSIGNED NOT NULL DEFAULT 0,
  error_report    JSON NULL,                               -- [{row, field, message}]
  filter_criteria JSON NULL,                               -- export scope
  requested_by    BIGINT UNSIGNED NULL,
  created_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  finished_at     DATETIME(3) NULL,
  PRIMARY KEY (id),
  KEY ix_csv_dir (direction, created_at),
  CONSTRAINT fk_csv_user FOREIGN KEY (requested_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- MySQL-backed job queue (keeps the stack Redis-free). Workers claim with SELECT ... FOR UPDATE SKIP LOCKED.
CREATE TABLE jobs (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  job_type     ENUM('discovery_run','verify_gig','health_sweep','pre_publish_verify','send_notification','csv_import') NOT NULL,
  payload      JSON NOT NULL,
  status       ENUM('queued','running','succeeded','failed','dead') NOT NULL DEFAULT 'queued',
  attempts     TINYINT UNSIGNED NOT NULL DEFAULT 0,
  max_attempts TINYINT UNSIGNED NOT NULL DEFAULT 3,
  run_after    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  locked_by    VARCHAR(80) NULL,
  locked_at    DATETIME(3) NULL,
  last_error   VARCHAR(1000) NULL,
  created_at   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  finished_at  DATETIME(3) NULL,
  PRIMARY KEY (id),
  KEY ix_jobs_claim (status, run_after, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- migrate:down
DROP TABLE IF EXISTS jobs;
DROP TABLE IF EXISTS csv_jobs;
DROP TABLE IF EXISTS settings;
DROP TABLE IF EXISTS audit_log;
