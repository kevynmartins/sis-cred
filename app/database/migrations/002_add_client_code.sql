USE sis_cred;

ALTER TABLE credit_requests
  ADD COLUMN client_code VARCHAR(40) NULL AFTER protocol;

UPDATE credit_requests
SET client_code = protocol
WHERE client_code IS NULL;

ALTER TABLE credit_requests
  MODIFY client_code VARCHAR(40) NOT NULL;

CREATE INDEX idx_requests_client_code ON credit_requests (client_code);