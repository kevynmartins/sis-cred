USE sis_cred;

-- Permite a analista devolver o cadastro ao vendedor durante a triagem, com uma
-- justificativa, em vez de só poder aprovar/empurrar adiante. O vendedor edita
-- e reenvia a ficha; isso limpa a justificativa e volta o status para RECEBIDA.
ALTER TABLE credit_requests
  MODIFY status ENUM('RECEBIDA', 'EM_ANALISE', 'AGUARDANDO_GESTAO', 'APROVADA', 'NEGADA', 'DEVOLVIDA') NOT NULL DEFAULT 'RECEBIDA',
  ADD COLUMN return_reason TEXT NULL AFTER seller_notes;
