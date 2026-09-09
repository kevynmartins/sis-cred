USE sis_cred;

-- Campos exigidos pela ficha cadastral para atender as solicitações do vendedor
-- sem retrabalho (código, motivo, contato, perguntas obrigatórias de entrega/autorização).
ALTER TABLE credit_requests
  ADD COLUMN contact_email VARCHAR(180) NULL AFTER finance_email,
  ADD COLUMN request_purpose VARCHAR(255) NULL AFTER contact_email,
  ADD COLUMN purchase_authorization VARCHAR(80) NULL AFTER request_purpose,
  ADD COLUMN delivery_type VARCHAR(80) NULL AFTER purchase_authorization,
  ADD COLUMN delivery_location VARCHAR(80) NULL AFTER delivery_type,
  ADD COLUMN delivery_address VARCHAR(255) NULL AFTER delivery_location;
