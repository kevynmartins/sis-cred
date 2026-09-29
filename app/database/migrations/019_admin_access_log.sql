USE sis_cred;

-- Registro dos acessos de manutenção: quando um administrador entra na conta de outro
-- usuário para investigar ou corrigir um problema, guardamos quem entrou, em qual conta,
-- quando começou/terminou e de onde. As ações feitas nesse período também ficam marcadas
-- na auditoria das solicitações (campo impersonatedBy em audit_events.event_data).
CREATE TABLE IF NOT EXISTS admin_access_log (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  admin_id INT UNSIGNED NOT NULL,
  target_user_id INT UNSIGNED NOT NULL,
  action ENUM('INICIO', 'FIM') NOT NULL,
  reason VARCHAR(255) NULL,
  ip_address VARCHAR(64) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_access_log_admin FOREIGN KEY (admin_id) REFERENCES users(id),
  CONSTRAINT fk_access_log_target FOREIGN KEY (target_user_id) REFERENCES users(id),
  INDEX idx_access_log_created (created_at)
) ENGINE=InnoDB;
