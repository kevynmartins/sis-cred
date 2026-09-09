USE sis_cred;

-- Os PDFs enviados (contrato social, Serasa, DEPS) agora ficam salvos
-- diretamente no banco de dados, em vez de arquivos em disco no servidor.
ALTER TABLE dossier_documents
  DROP COLUMN storage_key,
  ADD COLUMN file_data LONGBLOB NULL AFTER original_name;
