-- ATENÇÃO: SOMENTE PARA AMBIENTE DE DESENVOLVIMENTO/TESTE LOCAL.
-- NUNCA execute este arquivo em um banco de produção.
--
-- Antes deste arquivo existir, esses mesmos usuários eram criados automaticamente por
-- database/schema.sql com uma senha padrão conhecida e documentada publicamente
-- (admin123) — inclusive para a conta ADMIN. Qualquer instalação de produção que tivesse
-- rodado o schema sem trocar essa senha ficaria com uma conta administrativa de acesso
-- público. Este arquivo foi separado do schema principal exatamente para eliminar esse
-- risco: o schema sozinho não cria mais nenhum usuário.
--
-- Se ainda assim você aplicou este seed (ou uma versão antiga do schema) em produção,
-- troque a senha de TODOS os usuários abaixo imediatamente — veja o comando de reset em
-- database/migrations/005_reset_seed_passwords.sql como referência de formato, mas gere
-- hashes novos e exclusivos por usuário (nunca reaproveite o hash abaixo).

USE sis_cred;

-- Senha de desenvolvimento para todos os usuários semeados: admin123 (troque em produção).
INSERT INTO users (name, email, role, password_hash) VALUES
  ('Marina Costa', 'marina.costa@empresa.com.br', 'ANALISTA', '$2b$12$an42pfhuJDT2QOrG.MuPKuZc4hXUDbx3ezZYCEmZxjr.5pPuOP7hW'),
  ('Carlos Mendes', 'carlos.mendes@empresa.com.br', 'GESTORA', '$2b$12$an42pfhuJDT2QOrG.MuPKuZc4hXUDbx3ezZYCEmZxjr.5pPuOP7hW'),
  ('André Martins', 'andre.martins@empresa.com.br', 'VENDEDOR', '$2b$12$an42pfhuJDT2QOrG.MuPKuZc4hXUDbx3ezZYCEmZxjr.5pPuOP7hW'),
  ('Administrador do sistema', 'admin@empresa.com.br', 'ADMIN', '$2b$12$an42pfhuJDT2QOrG.MuPKuZc4hXUDbx3ezZYCEmZxjr.5pPuOP7hW')
ON DUPLICATE KEY UPDATE name = VALUES(name);
