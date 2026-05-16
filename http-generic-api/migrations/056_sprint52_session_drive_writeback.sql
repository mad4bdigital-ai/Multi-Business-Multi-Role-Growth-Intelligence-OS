-- Sprint 52: Drive-backed GPT session writeback
-- SQL remains the session index/control plane; Drive stores full transcript,
-- JSONL stream, artifacts, and exportable documents.

ALTER TABLE `customer_sessions`
  ADD COLUMN IF NOT EXISTS `drive_folder_id` VARCHAR(255) NULL
    COMMENT 'Drive folder ID for the session archive root'
    AFTER `drive_exported_at`,
  ADD COLUMN IF NOT EXISTS `drive_doc_id` VARCHAR(255) NULL
    COMMENT 'Google Doc ID for the human-readable session transcript'
    AFTER `drive_folder_id`,
  ADD COLUMN IF NOT EXISTS `drive_doc_url` VARCHAR(1024) NULL
    AFTER `drive_doc_id`,
  ADD COLUMN IF NOT EXISTS `drive_jsonl_id` VARCHAR(255) NULL
    COMMENT 'Drive file ID for replayable session JSONL events'
    AFTER `drive_doc_url`,
  ADD COLUMN IF NOT EXISTS `drive_jsonl_url` VARCHAR(1024) NULL
    AFTER `drive_jsonl_id`,
  ADD COLUMN IF NOT EXISTS `drive_exports_folder_id` VARCHAR(255) NULL
    AFTER `drive_jsonl_url`,
  ADD COLUMN IF NOT EXISTS `archive_status` VARCHAR(64) NULL
    COMMENT 'not_configured|ready|write_failed|closed'
    AFTER `drive_exports_folder_id`,
  ADD COLUMN IF NOT EXISTS `archive_last_error` TEXT NULL
    AFTER `archive_status`,
  ADD COLUMN IF NOT EXISTS `archive_last_written_at` DATETIME NULL
    AFTER `archive_last_error`;

ALTER TABLE `gpt_session_turns`
  ADD COLUMN IF NOT EXISTS `turn_id` VARCHAR(128) NULL
    AFTER `session_id`,
  ADD COLUMN IF NOT EXISTS `content_preview` TEXT NULL
    AFTER `content`,
  ADD COLUMN IF NOT EXISTS `content_sha256` VARCHAR(64) NULL
    AFTER `content_preview`,
  ADD COLUMN IF NOT EXISTS `drive_doc_id` VARCHAR(255) NULL
    AFTER `content_sha256`,
  ADD COLUMN IF NOT EXISTS `drive_anchor` VARCHAR(255) NULL
    AFTER `drive_doc_id`,
  ADD COLUMN IF NOT EXISTS `storage_mode` ENUM('inline','drive','hybrid') NOT NULL DEFAULT 'drive'
    AFTER `drive_anchor`;

ALTER TABLE `session_events`
  ADD COLUMN IF NOT EXISTS `tool_name` VARCHAR(128) NULL
    AFTER `event_type`,
  ADD COLUMN IF NOT EXISTS `status` VARCHAR(64) NULL
    AFTER `tool_name`,
  ADD COLUMN IF NOT EXISTS `payload_preview` TEXT NULL
    AFTER `payload_json`,
  ADD COLUMN IF NOT EXISTS `payload_sha256` VARCHAR(64) NULL
    AFTER `payload_preview`,
  ADD COLUMN IF NOT EXISTS `drive_artifact_id` VARCHAR(255) NULL
    AFTER `payload_sha256`,
  ADD COLUMN IF NOT EXISTS `drive_artifact_url` VARCHAR(1024) NULL
    AFTER `drive_artifact_id`,
  ADD COLUMN IF NOT EXISTS `redaction_status` VARCHAR(64) NULL
    AFTER `drive_artifact_url`;

CREATE TABLE IF NOT EXISTS `session_drive_artifacts` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `artifact_id` VARCHAR(128) NOT NULL,
  `session_id` VARCHAR(128) NOT NULL,
  `turn_id` VARCHAR(128) NULL,
  `event_id` VARCHAR(36) NULL,
  `tool_call_id` VARCHAR(128) NULL,
  `drive_file_id` VARCHAR(255) NOT NULL,
  `drive_file_url` VARCHAR(1024) NULL,
  `drive_file_name` VARCHAR(512) NULL,
  `mime_type` VARCHAR(128) NULL,
  `artifact_type` VARCHAR(128) NULL,
  `byte_size` BIGINT UNSIGNED NULL,
  `sha256` VARCHAR(64) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_session_artifact_id` (`artifact_id`),
  KEY `idx_session_artifacts_session` (`session_id`),
  KEY `idx_session_artifacts_turn` (`turn_id`),
  KEY `idx_session_artifacts_event` (`event_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
