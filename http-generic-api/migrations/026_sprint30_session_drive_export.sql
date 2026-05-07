-- Sprint 30: Session Drive export tracking + admin session support

ALTER TABLE `customer_sessions`
  ADD COLUMN IF NOT EXISTS `drive_export_id`  VARCHAR(255)  NULL COMMENT 'Drive file ID of the exported session document'
  AFTER `session_status`,
  ADD COLUMN IF NOT EXISTS `drive_export_url` VARCHAR(1024) NULL
  AFTER `drive_export_id`,
  ADD COLUMN IF NOT EXISTS `drive_exported_at` DATETIME     NULL
  AFTER `drive_export_url`;
