-- migrate:up
-- Adds the review actions introduced in Block 2.3 to the audit trail of reviewer decisions.
ALTER TABLE reviews MODIFY action ENUM('edit','reclassify','approve','reject','pause','stop','reopen','resume',
  'resolve_duplicate','accept_source_changes','dismiss_source_changes') NOT NULL;

-- migrate:down
-- (will fail if rows already use the new actions; delete those rows first)
ALTER TABLE reviews MODIFY action ENUM('edit','reclassify','approve','reject','pause','stop','reopen','resolve_duplicate') NOT NULL;
