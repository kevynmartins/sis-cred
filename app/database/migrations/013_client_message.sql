USE sis_cred;

-- Renomeia denial_message para client_message: agora guarda a mensagem que a
-- gestão escreve para o vendedor ver (aprovação ou negativa), separada da
-- justificativa interna (internal_reason), que continua visível só para
-- gestão e analista.
ALTER TABLE credit_requests CHANGE denial_message client_message VARCHAR(255) NULL;
