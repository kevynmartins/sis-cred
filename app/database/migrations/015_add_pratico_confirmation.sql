USE sis_cred;

-- Permite à analista confirmar que já registrou o resultado da decisão no
-- sistema Prático. Até confirmar, a decisão continua pendente na tela dela;
-- ao confirmar, sai da fila de pendências e passa para o histórico.
ALTER TABLE credit_requests
  ADD COLUMN pratico_confirmed_at TIMESTAMP NULL AFTER client_message,
  ADD COLUMN pratico_confirmed_by INT UNSIGNED NULL AFTER pratico_confirmed_at,
  ADD CONSTRAINT fk_requests_pratico_confirmed_by FOREIGN KEY (pratico_confirmed_by) REFERENCES users(id);
