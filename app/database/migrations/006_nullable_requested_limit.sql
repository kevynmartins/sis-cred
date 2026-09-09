USE sis_cred;

-- O vendedor não informa mais o limite solicitado; quem decide o valor é a gestão
-- na hora da aprovação (approved_limit em credit_decisions / credit_requests).
ALTER TABLE credit_requests MODIFY requested_limit DECIMAL(15,2) NULL;
