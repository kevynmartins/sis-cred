-- ATENÇÃO: cria a conta admin@empresa.com.br com um hash de senha conhecido/documentado
-- neste repositório. NUNCA rode esta migration em produção — veja database/seed-dev-users.sql
-- e a seção "Criando o primeiro administrador em produção" do README.
USE sis_cred;

INSERT INTO users (name, email, role, password_hash, active)
VALUES ('Administrador do sistema', 'admin@empresa.com.br', 'ADMIN', '$2b$12$Q/X1bp92lhEWHrOIl21/4OUXRKPECSP7J5IpTGycbg7wrmvFtiJTq', 1)
ON DUPLICATE KEY UPDATE role = 'ADMIN', active = 1;