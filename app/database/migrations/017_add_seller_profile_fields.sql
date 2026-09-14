USE sis_cred;

-- Dados adicionais do vendedor para a analista e a gestão conseguirem identificar
-- quem fez a solicitação: número dele no sistema Prático, loja onde trabalha, nome
-- do gerente responsável e um contato direto (celular/WhatsApp).
ALTER TABLE users
  ADD COLUMN pratico_seller_code VARCHAR(40) NULL AFTER role,
  ADD COLUMN store_name VARCHAR(120) NULL AFTER pratico_seller_code,
  ADD COLUMN manager_name VARCHAR(150) NULL AFTER store_name,
  ADD COLUMN whatsapp_phone VARCHAR(30) NULL AFTER manager_name;
