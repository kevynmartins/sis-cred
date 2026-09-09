USE sis_cred;

-- Permite que cada usuário troque o próprio nome (coluna já existia) e
-- adicione uma foto de perfil, guardada como blob junto do tipo MIME.
ALTER TABLE users
  ADD COLUMN avatar_mime VARCHAR(50) NULL AFTER password_hash,
  ADD COLUMN avatar_data MEDIUMBLOB NULL AFTER avatar_mime;
