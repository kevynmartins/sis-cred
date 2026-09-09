USE sis_cred;

-- Guarda os dados da ficha cadastral preenchida pelo vendedor,
-- para a analista conseguir ver tudo na triagem.
ALTER TABLE credit_requests
  ADD COLUMN trade_name VARCHAR(180) NULL AFTER company_name,
  ADD COLUMN state_registration VARCHAR(40) NULL AFTER cnpj,
  ADD COLUMN phone VARCHAR(30) NULL AFTER state_registration,
  ADD COLUMN address VARCHAR(255) NULL AFTER phone,
  ADD COLUMN invoice_email VARCHAR(180) NULL AFTER address,
  ADD COLUMN finance_email VARCHAR(180) NULL AFTER invoice_email;
