USE sis_cred;

-- Nome do contato do cliente, e telefone/e-mail de contato ampliados para
-- comportar múltiplos valores (separados por "; ") preenchidos no cadastro do vendedor.
ALTER TABLE credit_requests
  ADD COLUMN contact_name VARCHAR(150) NULL AFTER finance_email,
  MODIFY phone VARCHAR(150) NULL,
  MODIFY contact_email VARCHAR(255) NULL;
