-- Sprint 29b: Add user_email to uploads for Drive sharing and scoped listing

ALTER TABLE `uploads`
  ADD COLUMN IF NOT EXISTS `user_email` VARCHAR(255) NULL COMMENT 'User email: Drive file shared with writer access on upload, used for scoped listing'
  AFTER `uploaded_by`;
