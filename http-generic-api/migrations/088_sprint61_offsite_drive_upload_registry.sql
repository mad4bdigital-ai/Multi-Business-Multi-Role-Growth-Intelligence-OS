-- Sprint 61: Offsite Drive upload registry
--
-- Tracks short-lived upload sessions and Drive upload records for off-device
-- backup artifacts, manifests, and recovery keys.
-- Idempotent. No DELETE/TRUNCATE/DROP.

CREATE TABLE IF NOT EXISTS offsite_drive_upload_sessions (
  session_id VARCHAR(64) NOT NULL PRIMARY KEY,
  token_sha256 VARCHAR(128) NOT NULL,
  parent_folder_id VARCHAR(191) NOT NULL,
  status ENUM('active','used','expired','revoked') NOT NULL DEFAULT 'active',
  upload_count INT NOT NULL DEFAULT 0,
  created_by VARCHAR(191) NULL,
  expires_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_offsite_drive_upload_status (status, expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS offsite_drive_upload_records (
  record_id VARCHAR(36) NOT NULL PRIMARY KEY,
  session_id VARCHAR(64) NOT NULL,
  subfolder VARCHAR(64) NOT NULL,
  file_name VARCHAR(255) NOT NULL,
  drive_file_id VARCHAR(191) NOT NULL,
  drive_parent_id VARCHAR(191) NOT NULL,
  sha256 VARCHAR(128) NOT NULL,
  size_bytes BIGINT NOT NULL,
  status ENUM('uploaded','verified','failed') NOT NULL DEFAULT 'uploaded',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_offsite_drive_record_session (session_id, subfolder),
  KEY idx_offsite_drive_record_file (drive_file_id),
  CONSTRAINT fk_offsite_drive_record_session
    FOREIGN KEY (session_id) REFERENCES offsite_drive_upload_sessions(session_id)
    ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
