-- Área "Atualização de dados" do vendedor: registra correções de contato e endereço
-- do cliente sem passar pela fila de liberação de limite de crédito.
--
-- Diferente de credit_requests, esta tabela NÃO guarda limite, decisão nem dossiê:
-- é só o registro do que mudou, quem pediu e a conferência da analista.
-- A gravação no Prático continua sendo feita por uma pessoa (a analista), nunca pela API.

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

-- A trilha de auditoria passa a registrar também os eventos de atualização de dados,
-- que não pertencem a nenhuma solicitação de crédito. Por isso request_id vira NULLABLE
-- e a coluna data_update_id guarda a qual registro o evento se refere.
-- A FK precisa ser removida antes de alterar a coluna para NULL, no MariaDB.
ALTER TABLE audit_events DROP FOREIGN KEY fk_audit_request;
ALTER TABLE audit_events MODIFY request_id INT UNSIGNED NULL;
ALTER TABLE audit_events ADD COLUMN data_update_id INT UNSIGNED NULL AFTER request_id;
ALTER TABLE audit_events
  ADD CONSTRAINT fk_audit_request FOREIGN KEY (request_id) REFERENCES credit_requests(id) ON DELETE CASCADE,
  ADD CONSTRAINT fk_audit_data_update FOREIGN KEY (data_update_id) REFERENCES client_data_updates(id) ON DELETE CASCADE,
  ADD INDEX idx_audit_data_update (data_update_id);