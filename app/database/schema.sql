CREATE DATABASE IF NOT EXISTS sis_cred CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE sis_cred;

CREATE TABLE IF NOT EXISTS users (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  email VARCHAR(180) NOT NULL UNIQUE,
  role ENUM('VENDEDOR', 'ANALISTA', 'GESTORA', 'ADMIN') NOT NULL,
  pratico_seller_code VARCHAR(40) NULL,
  store_name VARCHAR(120) NULL,
  manager_name VARCHAR(150) NULL,
  whatsapp_phone VARCHAR(30) NULL,
  password_hash VARCHAR(255) NOT NULL,
  avatar_mime VARCHAR(50) NULL,
  avatar_data MEDIUMBLOB NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS password_resets (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  token_hash CHAR(64) NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  used_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_password_resets_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_password_resets_token (token_hash),
  INDEX idx_password_resets_user (user_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS credit_requests (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  protocol VARCHAR(30) NOT NULL UNIQUE,
  client_code VARCHAR(40) NOT NULL,
  company_name VARCHAR(180) NOT NULL,
  trade_name VARCHAR(180) NULL,
  cnpj CHAR(18) NOT NULL,
  state_registration VARCHAR(40) NULL,
  phone VARCHAR(150) NULL,
  address VARCHAR(255) NULL,
  invoice_email VARCHAR(180) NULL,
  finance_email VARCHAR(180) NULL,
  contact_name VARCHAR(255) NULL,
  contact_email VARCHAR(255) NULL,
  request_purpose VARCHAR(255) NULL,
  purchase_authorization VARCHAR(80) NULL,
  delivery_type VARCHAR(80) NULL,
  delivery_location VARCHAR(80) NULL,
  delivery_address VARCHAR(255) NULL,
  seller_id INT UNSIGNED NOT NULL,
  requested_limit DECIMAL(15,2) NULL,
  origin VARCHAR(120) NULL,
  seller_notes TEXT NULL,
  return_reason TEXT NULL,
  status ENUM('RECEBIDA', 'EM_ANALISE', 'AGUARDANDO_GESTAO', 'APROVADA', 'NEGADA', 'DEVOLVIDA') NOT NULL DEFAULT 'RECEBIDA',
  approved_limit DECIMAL(15,2) NULL,
  client_message VARCHAR(255) NULL,
  pratico_confirmed_at TIMESTAMP NULL,
  pratico_confirmed_by INT UNSIGNED NULL,
  submitted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_requests_seller FOREIGN KEY (seller_id) REFERENCES users(id),
  CONSTRAINT fk_requests_pratico_confirmed_by FOREIGN KEY (pratico_confirmed_by) REFERENCES users(id),
  INDEX idx_requests_status (status),
  INDEX idx_requests_client_code (client_code),
  INDEX idx_requests_cnpj (cnpj)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS dossier_documents (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  request_id INT UNSIGNED NOT NULL,
  document_type ENUM('CNPJ', 'CONTRATO_SOCIAL', 'INSCRICAO_ESTADUAL', 'SERASA', 'DEPS', 'OUTRO') NOT NULL,
  original_name VARCHAR(255) NOT NULL,
  file_data LONGBLOB NULL,
  file_size BIGINT UNSIGNED NOT NULL,
  extracted_data JSON NULL,
  mime_type VARCHAR(100) NOT NULL,
  uploaded_by INT UNSIGNED NOT NULL,
  uploaded_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_documents_request FOREIGN KEY (request_id) REFERENCES credit_requests(id) ON DELETE CASCADE,
  CONSTRAINT fk_documents_user FOREIGN KEY (uploaded_by) REFERENCES users(id),
  INDEX idx_documents_request (request_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS credit_decisions (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  request_id INT UNSIGNED NOT NULL,
  manager_id INT UNSIGNED NOT NULL,
  decision ENUM('APROVADA', 'NEGADA') NOT NULL,
  approved_limit DECIMAL(15,2) NULL,
  internal_reason TEXT NULL,
  decided_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_decisions_request FOREIGN KEY (request_id) REFERENCES credit_requests(id) ON DELETE CASCADE,
  CONSTRAINT fk_decisions_manager FOREIGN KEY (manager_id) REFERENCES users(id),
  INDEX idx_decisions_request (request_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS notifications (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  request_id INT UNSIGNED NOT NULL,
  recipient_user_id INT UNSIGNED NOT NULL,
  channel ENUM('EMAIL', 'SISTEMA') NOT NULL DEFAULT 'EMAIL',
  subject VARCHAR(255) NOT NULL,
  body TEXT NOT NULL,
  status ENUM('PENDENTE', 'ENVIADA', 'FALHA') NOT NULL DEFAULT 'PENDENTE',
  sent_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_notifications_request FOREIGN KEY (request_id) REFERENCES credit_requests(id) ON DELETE CASCADE,
  CONSTRAINT fk_notifications_recipient FOREIGN KEY (recipient_user_id) REFERENCES users(id)
) ENGINE=InnoDB;

-- request_id fica NULLABLE porque a trilha também registra a área de atualização de
-- dados, que não pertence a nenhuma solicitação de crédito (data_update_id).
CREATE TABLE IF NOT EXISTS audit_events (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  request_id INT UNSIGNED NULL,
  data_update_id INT UNSIGNED NULL,
  actor_id INT UNSIGNED NOT NULL,
  event_type VARCHAR(80) NOT NULL,
  event_data JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_audit_request FOREIGN KEY (request_id) REFERENCES credit_requests(id) ON DELETE CASCADE,
  CONSTRAINT fk_audit_data_update FOREIGN KEY (data_update_id) REFERENCES client_data_updates(id) ON DELETE CASCADE,
  CONSTRAINT fk_audit_actor FOREIGN KEY (actor_id) REFERENCES users(id),
  INDEX idx_audit_request (request_id),
  INDEX idx_audit_data_update (data_update_id)
) ENGINE=InnoDB;

-- Área "Atualização de dados" do vendedor: correções de contato e endereço que não
-- passam pela fila de limite de crédito. A gravação no Prático é sempre feita por
-- uma pessoa (a analista), que então confirma ou descarta o registro.
CREATE TABLE IF NOT EXISTS client_data_updates (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  reference VARCHAR(30) NOT NULL UNIQUE,
  client_code VARCHAR(40) NOT NULL,
  cnpj VARCHAR(18) NULL,
  company_name VARCHAR(180) NOT NULL,
  seller_id INT UNSIGNED NOT NULL,
  contact_name VARCHAR(150) NULL,
  phone VARCHAR(60) NULL,
  phone_mobile VARCHAR(60) NULL,
  email VARCHAR(180) NULL,
  invoice_email VARCHAR(180) NULL,
  finance_email VARCHAR(180) NULL,
  street VARCHAR(180) NULL,
  street_number VARCHAR(30) NULL,
  street_complement VARCHAR(120) NULL,
  district VARCHAR(120) NULL,
  city VARCHAR(120) NULL,
  state CHAR(2) NULL,
  zip_code VARCHAR(9) NULL,
  notes TEXT NULL,
  status ENUM('REGISTRADA', 'CONFIRMADA', 'DESCARTADA') NOT NULL DEFAULT 'REGISTRADA',
  reviewed_at TIMESTAMP NULL,
  reviewed_by INT UNSIGNED NULL,
  review_notes TEXT NULL,
  rejection_reason VARCHAR(255) NULL,
  registered_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_data_updates_seller FOREIGN KEY (seller_id) REFERENCES users(id),
  CONSTRAINT fk_data_updates_reviewer FOREIGN KEY (reviewed_by) REFERENCES users(id),
  INDEX idx_data_updates_seller (seller_id),
  INDEX idx_data_updates_status (status),
  INDEX idx_data_updates_client (client_code),
  INDEX idx_data_updates_registered (registered_at)
) ENGINE=InnoDB;

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

-- Nenhum usuário é criado por este schema. Para gerar o primeiro administrador (com senha
-- própria, não uma senha padrão conhecida), veja database/seed-dev-users.sql — use-o apenas
-- em ambiente de desenvolvimento/teste, nunca em produção.
