-- Sprint 30b: Store session raw dump in Drive (one file per session).
-- DB keeps only structured query fields; content lives in Drive.

ALTER TABLE `customer_sessions`
  ADD COLUMN IF NOT EXISTS `raw_drive_id`  VARCHAR(255)  NULL COMMENT 'Drive file ID of the full raw session dump'
  AFTER `session_status`,
  ADD COLUMN IF NOT EXISTS `raw_drive_url` VARCHAR(1024) NULL
  AFTER `raw_drive_id`,
  ADD COLUMN IF NOT EXISTS `base_instructions_drive_id`  VARCHAR(255)  NULL COMMENT 'Drive file ID when base_instructions exceeds inline threshold'
  AFTER `base_instructions_text`,
  ADD COLUMN IF NOT EXISTS `base_instructions_drive_url` VARCHAR(1024) NULL
  AFTER `base_instructions_drive_id`;
