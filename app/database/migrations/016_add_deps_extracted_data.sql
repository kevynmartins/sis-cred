USE sis_cred;

-- Guarda os dados que o sistema conseguiu extrair automaticamente do PDF de
-- Avaliação DEPS no momento do upload (classificação, limite sugerido, risco,
-- protestos, PEFIN, histórico de pagamentos etc.), em vez de exibir sempre os
-- mesmos valores de exemplo na tela da analista e da gestão.
ALTER TABLE dossier_documents
  ADD COLUMN extracted_data JSON NULL AFTER file_size;
