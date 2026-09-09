USE sis_cred;

ALTER TABLE users ADD COLUMN password_hash VARCHAR(255) NULL AFTER role;

UPDATE users
SET password_hash = '$2b$12$Q/X1bp92lhEWHrOIl21/4OUXRKPECSP7J5IpTGycbg7wrmvFtiJTq'
WHERE email IN ('andre.martins@empresa.com.br', 'marina.costa@empresa.com.br', 'carlos.mendes@empresa.com.br', 'admin@empresa.com.br')
  AND password_hash IS NULL;

ALTER TABLE users MODIFY password_hash VARCHAR(255) NOT NULL;