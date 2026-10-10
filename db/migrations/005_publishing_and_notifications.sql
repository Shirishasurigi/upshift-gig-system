-- migrate:up
CREATE TABLE publications (
  id                          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  gig_id                      BIGINT UNSIGNED NOT NULL,
  status                      ENUM('publish_ready','published','unpublished','failed') NOT NULL,
  pre_publish_verification_id BIGINT UNSIGNED NULL,        -- PUB-02 proof that a recheck ran
  snapshot                    JSON NOT NULL,               -- exact 19-column record that went live
  published_by                BIGINT UNSIGNED NULL,
  published_at                DATETIME(3) NULL,
  unpublished_by              BIGINT UNSIGNED NULL,        -- NULL + reason => automatic (system) unpublish
  unpublished_at              DATETIME(3) NULL,
  unpublish_reason            VARCHAR(500) NULL,
  failure_reason              VARCHAR(1000) NULL,
  created_at                  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at                  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_pub_gig (gig_id, created_at),
  KEY ix_pub_status (status, published_at),
  CONSTRAINT fk_pub_gig   FOREIGN KEY (gig_id)                      REFERENCES gigs(id),
  CONSTRAINT fk_pub_ver   FOREIGN KEY (pre_publish_verification_id) REFERENCES verifications(id),
  CONSTRAINT fk_pub_by    FOREIGN KEY (published_by)                REFERENCES users(id),
  CONSTRAINT fk_pub_unby  FOREIGN KEY (unpublished_by)              REFERENCES users(id),
  CONSTRAINT chk_pub_published_has_proof CHECK (
    status <> 'published' OR (pre_publish_verification_id IS NOT NULL AND published_by IS NOT NULL AND published_at IS NOT NULL)
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE notifications (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  publication_id BIGINT UNSIGNED NULL,
  gig_id         BIGINT UNSIGNED NULL,
  audience       ENUM('learners','site','admins') NOT NULL,
  type           ENUM('published','unpublished','publish_failed','gig_status_changed') NOT NULL,
  channel        ENUM('webhook','email','in_app') NOT NULL,
  recipient      VARCHAR(255) NULL,
  payload        JSON NOT NULL,
  status         ENUM('pending','sent','failed','skipped') NOT NULL DEFAULT 'pending',
  attempts       TINYINT UNSIGNED NOT NULL DEFAULT 0,
  last_error     VARCHAR(1000) NULL,
  created_at     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  sent_at        DATETIME(3) NULL,
  PRIMARY KEY (id),
  KEY ix_notif_status (status, created_at),
  KEY ix_notif_gig (gig_id),
  CONSTRAINT fk_notif_pub FOREIGN KEY (publication_id) REFERENCES publications(id),
  CONSTRAINT fk_notif_gig FOREIGN KEY (gig_id)         REFERENCES gigs(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- migrate:down
DROP TABLE IF EXISTS notifications;
DROP TABLE IF EXISTS publications;
