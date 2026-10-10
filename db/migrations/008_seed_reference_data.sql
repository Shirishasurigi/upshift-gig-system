-- migrate:up
INSERT INTO modules (id, name, description, display_order, search_keywords) VALUES
('M1','AI Video / Reels','Short-form video, AI video production, reels and related content work',1,
  JSON_ARRAY('reels','short-form video','video editor','ai video','video production','shorts')),
('M2','AI Design / Visual','Visual design and AI-generated creative assets',2,
  JSON_ARRAY('graphic design','brand assets','image generation','visual design','logo','illustration')),
('M3','AI Data Annotation / Evaluation','Data annotation, AI evaluation, model feedback and related work',3,
  JSON_ARRAY('data annotation','ai evaluator','rlhf','model evaluation','labeling','ai trainer')),
('M4','AI Coding / Development','Software, web, app and AI-assisted development',4,
  JSON_ARRAY('web developer','app development','software engineer','coding','ai developer','full stack')),
('M5','AI Marketing / Growth','Marketing, social, growth, SEO and related work',5,
  JSON_ARRAY('seo','social media','digital marketing','growth','content marketing','copywriting')),
('M6','AI Automation / Agents','Automation, AI agents and workflow systems',6,
  JSON_ARRAY('n8n','make.com','zapier','ai agent','workflow automation','automation engineer'));

-- Sources. Only SAMPLE_CSV is enabled: it is the team's own supplied dataset.
-- Mercor / Mindrift / Fiverr are PLACEHOLDERS: FRD s.9 says a permitted access method must be determined first.
-- chk_sources_enable_requires_review prevents enabling them until access_method + terms review are recorded.
INSERT INTO sources (code, name, access_method, access_method_notes, enablement, health, terms_reviewed_at, referral_required) VALUES
('SAMPLE_CSV','Supplied sample dataset (CSV)','csv_import','Developer-supplied 100-200 sample gigs; no external access.','enabled','healthy',CURRENT_TIMESTAMP(3),0),
('MERCOR','Mercor','undetermined','Placeholder. Determine official API / feed / permitted page access and review ToS before enabling.','disabled','unknown',NULL,0),
('MINDRIFT','Mindrift','undetermined','Placeholder. Determine official API / feed / permitted page access and review ToS before enabling.','disabled','unknown',NULL,0),
('FIVERR','Fiverr','undetermined','Placeholder. Determine official API / feed / permitted page access and review ToS before enabling.','disabled','unknown',NULL,0);

INSERT INTO settings (key_name, value, description) VALUES
('verification.confidence_active_min',      '0.85', 'Minimum confidence (with explicit open signal) to auto-label Active'),
('verification.confidence_review_below',    '0.60', 'Below this confidence the result is forced to Needs Review'),
('classification.confidence_min',           '0.70', 'Below this the module is left blank for manual classification'),
('dedup.similarity_threshold',              '0.88', 'Content similarity at/above which a suspected duplicate is flagged'),
('publish.recheck_max_age_minutes',         '10',   'A pre-publish verification older than this is not accepted'),
('publish.referral_mandatory_default',      'false','Default when a source does not set referral_required'),
('publish.require_different_publisher',     'false','If true, the publisher must differ from the approving reviewer'),
('health.sweep_interval_hours',             '24',   'Re-check cadence for published gigs'),
('raw.retention_days',                      '30',   'Retention of raw_extracts content'),
('notifications.learner_channel_enabled',   'false','Learner-facing notification channel (webhook/email) on/off');

-- migrate:down
DELETE FROM settings;
DELETE FROM sources WHERE code IN ('SAMPLE_CSV','MERCOR','MINDRIFT','FIVERR');
DELETE FROM modules;
