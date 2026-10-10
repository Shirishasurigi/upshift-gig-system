-- migrate:up
-- Defence-in-depth for business rules the application also enforces.
-- NOTE: the migration runner must execute this file with mysql2 `multipleStatements: true` (no DELIMITER needed).
-- On servers with binary logging, the DB user needs SUPER or log_bin_trust_function_creators=1 to create triggers.

-- PUB-01/PUB-05: a gig may only be 'published' if it is active or paused (never stopped / needs_review / unreviewed track)
CREATE TRIGGER trg_gigs_publish_guard BEFORE UPDATE ON gigs
FOR EACH ROW
BEGIN
  IF NEW.workflow_state = 'published'
     AND (NEW.availability_status NOT IN ('active','paused') OR NEW.track_id IS NULL OR NEW.title IS NULL) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Gig cannot be published: status not active/paused or required field missing';
  END IF;
END;

-- NOT-03: learner-facing "published" notification must reference a gig that is actually published
CREATE TRIGGER trg_notifications_no_false_publish BEFORE INSERT ON notifications
FOR EACH ROW
BEGIN
  IF NEW.audience = 'learners' AND NEW.type = 'published' THEN
    IF NEW.gig_id IS NULL
       OR (SELECT workflow_state FROM gigs WHERE id = NEW.gig_id) <> 'published' THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Learner notification blocked: gig is not published';
    END IF;
  END IF;
END;

-- migrate:down
DROP TRIGGER IF EXISTS trg_notifications_no_false_publish;
DROP TRIGGER IF EXISTS trg_gigs_publish_guard;
