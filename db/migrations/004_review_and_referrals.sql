-- migrate:up
CREATE TABLE reviews (
  id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  gig_id             BIGINT UNSIGNED NOT NULL,
  reviewer_id        BIGINT UNSIGNED NOT NULL,
  action             ENUM('edit','reclassify','approve','reject','pause','stop','reopen','resolve_duplicate') NOT NULL,
  from_workflow_state VARCHAR(30) NULL,
  to_workflow_state   VARCHAR(30) NULL,
  from_availability   VARCHAR(30) NULL,
  to_availability     VARCHAR(30) NULL,
  field_changes      JSON NULL,                            -- {field: {old, new}}
  note               VARCHAR(2000) NULL,
  created_at         DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_rev_gig (gig_id, created_at),
  KEY ix_rev_reviewer (reviewer_id, created_at),
  CONSTRAINT fk_rev_gig      FOREIGN KEY (gig_id)      REFERENCES gigs(id),
  CONSTRAINT fk_rev_reviewer FOREIGN KEY (reviewer_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Referral value supplied by a human. Scope: one gig OR a whole source (gig-level overrides source-level).
CREATE TABLE referrals (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  gig_id         BIGINT UNSIGNED NULL,
  source_id      BIGINT UNSIGNED NULL,
  referral_type  ENUM('id','link') NOT NULL,
  referral_value VARCHAR(1024) NOT NULL,
  is_active      TINYINT(1) NOT NULL DEFAULT 1,
  entered_by     BIGINT UNSIGNED NOT NULL,
  entered_at     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_by     BIGINT UNSIGNED NULL,
  updated_at     DATETIME(3) NULL,
  active_gig_key    BIGINT UNSIGNED GENERATED ALWAYS AS (IF(is_active = 1, gig_id, NULL)) STORED,
  active_source_key BIGINT UNSIGNED GENERATED ALWAYS AS (IF(is_active = 1, source_id, NULL)) STORED,
  PRIMARY KEY (id),
  UNIQUE KEY uq_ref_active_gig (active_gig_key),           -- at most one active referral per gig
  UNIQUE KEY uq_ref_active_source (active_source_key),     -- at most one active referral per source
  CONSTRAINT fk_ref_gig     FOREIGN KEY (gig_id)     REFERENCES gigs(id),
  CONSTRAINT fk_ref_source  FOREIGN KEY (source_id)  REFERENCES sources(id),
  CONSTRAINT fk_ref_entered FOREIGN KEY (entered_by) REFERENCES users(id),
  CONSTRAINT fk_ref_updated FOREIGN KEY (updated_by) REFERENCES users(id),
  CONSTRAINT chk_ref_scope  CHECK ((gig_id IS NOT NULL) <> (source_id IS NOT NULL))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE referral_history (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  referral_id BIGINT UNSIGNED NOT NULL,
  change_type ENUM('create','update','deactivate') NOT NULL,
  old_value   VARCHAR(1024) NULL,
  new_value   VARCHAR(1024) NULL,
  changed_by  BIGINT UNSIGNED NOT NULL,
  created_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_refh_ref (referral_id, created_at),
  CONSTRAINT fk_refh_ref  FOREIGN KEY (referral_id) REFERENCES referrals(id),
  CONSTRAINT fk_refh_user FOREIGN KEY (changed_by)  REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- migrate:down
DROP TABLE IF EXISTS referral_history;
DROP TABLE IF EXISTS referrals;
DROP TABLE IF EXISTS reviews;
