USE sis_cred;

-- O vendedor agora pode informar mais de um nome de contato (separados por "; ").
ALTER TABLE credit_requests MODIFY contact_name VARCHAR(255) NULL;
