# Sis-Cred

MVP do fluxo digital de análise de crédito, com frontend React/Vite e API Node/Express conectada ao MariaDB.

## Banco MariaDB

1. Instale o MariaDB e abra o cliente `mariadb` (ou `mysql`) com um usuário administrador.
2. Crie o usuário da aplicação:

```sql
CREATE USER 'sis_cred'@'localhost' IDENTIFIED BY 'troque_esta_senha';
GRANT ALL PRIVILEGES ON sis_cred.* TO 'sis_cred'@'localhost';
FLUSH PRIVILEGES;
```

3. Execute o schema em `database/schema.sql`:

```bash
mariadb -u root -p < database/schema.sql
```

4. Copie `.env.example` para `.env` e informe a senha configurada.

Se o banco já foi criado antes do campo de código Prático, aplique a migration:

```powershell
Get-Content .\database\migrations\002_add_client_code.sql -Raw | mariadb -u root -p
```

### Usuários de desenvolvimento (NUNCA em produção)

`database/schema.sql` **não cria nenhum usuário**. Para ter contas de teste em ambiente local, aplique:

```powershell
Get-Content .\database\seed-dev-users.sql -Raw | mariadb -u root -p
```

Isso cria `admin@empresa.com.br`, `andre.martins@empresa.com.br`, `marina.costa@empresa.com.br` e `carlos.mendes@empresa.com.br`, todos com a senha `admin123`. Essa senha é pública (está neste repositório) — **use apenas em desenvolvimento**. As migrations `003_seed_admin_user.sql` e `005_reset_seed_passwords.sql` são mantidas por compatibilidade histórica, mas têm o mesmo efeito e a mesma restrição.

### Criando o primeiro administrador em produção

Nunca use o seed de desenvolvimento em produção. Gere um hash bcrypt para uma senha forte e exclusiva:

```bash
node -e "require('bcryptjs').hash(process.argv[1], 12).then(console.log)" "SUA_SENHA_FORTE_AQUI"
```

E insira o usuário com esse hash:

```sql
INSERT INTO users (name, email, role, password_hash) VALUES
  ('Nome do administrador', 'admin@suaempresa.com.br', 'ADMIN', '<hash_gerado_acima>');
```

Troque a senha pelo próprio sistema (Editar perfil → Trocar senha) assim que fizer o primeiro login.

Se o banco já existia antes da foto de perfil ser adicionada, aplique a migration:

```powershell
Get-Content .\database\migrations\014_add_user_profile_photo.sql -Raw | mariadb -u root -p
```

Se o banco já existia antes da confirmação no Prático ser adicionada, aplique a migration:

```powershell
Get-Content .\database\migrations\015_add_pratico_confirmation.sql -Raw | mariadb -u root -p
```

## Executar

Em terminais separados, dentro de `app`:

```bash
npm run dev
npm run api
```

A interface fica em `http://localhost:5173` e a API em `http://localhost:3001`. O endpoint `GET /api/health` testa a conexão com o MariaDB.

## API inicial

- `GET /api/credit-requests`: lista solicitações, com filtro opcional `?status=EM_ANALISE`.
- `POST /api/credit-requests`: cria uma solicitação do vendedor.
- `PATCH /api/credit-requests/:id/decision`: registra a decisão da gestão em transação, com auditoria.

## Validação

```bash
npm run typecheck:api
npm run build
```

## Manual do usuário

Guia de uso do sistema e das funções de cada perfil (Vendedor, Analista, Gestão, Administrador) em
[`docs/MANUAL_USUARIO.md`](./docs/MANUAL_USUARIO.md).

## Produção

Para instalar em um servidor Linux ou Windows, veja o guia completo em
[`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md), com passo a passo específico para:

- [Linux (Nginx + systemd)](./docs/deploy-linux.md)
- [Windows Server (IIS + NSSM)](./docs/deploy-windows.md)

Build de produção (frontend + API compilada):

```bash
npm run build:prod
npm start   # roda dist-server/index.js
```

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend enabling type-aware lint rules by installing `oxlint-tsgolint` and editing `.oxlintrc.json`:

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "plugins": ["react", "typescript", "oxc"],
  "options": {
    "typeAware": true
  },
  "rules": {
    "react/rules-of-hooks": "error",
    "react/only-export-components": ["warn", { "allowConstantExport": true }]
  }
}
```

See the [Oxlint rules documentation](https://oxc.rs/docs/guide/usage/linter/rules) for the full list of rules and categories.
