-- ATENÇÃO: define a mesma senha pública (admin123) para todos os usuários listados abaixo.
-- NUNCA rode esta migration em produção — veja database/seed-dev-users.sql e a seção
-- "Criando o primeiro administrador em produção" do README.
USE sis_cred;

-- Define a senha de desenvolvimento padrão para os usuários semeados,
-- já que o hash original não tinha senha em texto plano documentada.
-- Senha: admin123 (troque em produção).
UPDATE users
SET password_hash = '$2b$12$an42pfhuJDT2QOrG.MuPKuZc4hXUDbx3ezZYCEmZxjr.5pPuOP7hW'
WHERE email IN (
  'andre.martins@empresa.com.br',
  'marina.costa@empresa.com.br',
  'carlos.mendes@empresa.com.br',
  'admin@empresa.com.br'
);
