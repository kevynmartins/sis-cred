CREATE DATABASE IF NOT EXISTS sis_cred CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE sis_cred;

CREATE TABLE IF NOT EXISTS users (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  email VARCHAR(180) NOT NULL UNIQUE,
  role ENUM('VENDEDOR', 'ANALISTA', 'GESTORA', 'ADMIN') NOT NULL,
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
  status ENUM('RECEBIDA', 'EM_ANALISE', 'AGUARDANDO_GESTAO', 'APROVADA', 'NEGADA') NOT NULL DEFAULT 'RECEBIDA',
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

CREATE TABLE IF NOT EXISTS audit_events (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  request_id INT UNSIGNED NOT NULL,
  actor_id INT UNSIGNED NOT NULL,
  event_type VARCHAR(80) NOT NULL,
  event_data JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_audit_request FOREIGN KEY (request_id) REFERENCES credit_requests(id) ON DELETE CASCADE,
  CONSTRAINT fk_audit_actor FOREIGN KEY (actor_id) REFERENCES users(id),
  INDEX idx_audit_request (request_id)
) ENGINE=InnoDB;

-- Nenhum usuário é criado por este schema. Para gerar o primeiro administrador (com senha
-- própria, não uma senha padrão conhecida), veja database/seed-dev-users.sql — use-o apenas
-- em ambiente de desenvolvimento/teste, nunca em produção.
