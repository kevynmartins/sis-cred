# Sis-Cred — Guia de Produção

Este documento descreve a arquitetura de implantação do Sis-Cred e serve de ponto de
entrada para os guias específicos de cada sistema operacional:

- [`deploy-linux.md`](./deploy-linux.md) — Ubuntu/Debian com Nginx + systemd.
- [`deploy-windows.md`](./deploy-windows.md) — Windows Server com IIS + NSSM.

## Arquitetura

O Sis-Cred é composto por três peças que **rodam separadas** em produção:

```
┌────────────┐      HTTPS       ┌───────────────────┐      HTTP (localhost)      ┌──────────────┐
│  Navegador │ ───────────────► │  Nginx / IIS       │ ──────────────────────────►│  API Node     │
│            │                  │  (porta 443)        │   /api/*  →  127.0.0.1:3001│  (Express)    │
└────────────┘                  │  serve dist/ (SPA)  │                             └──────┬───────┘
                                 └───────────────────┘                                     │
                                                                                            ▼
                                                                                   ┌──────────────┐
                                                                                   │  MariaDB      │
                                                                                   │  (porta 3306) │
                                                                                   └──────────────┘
```

- **Frontend**: build estático do Vite/React (`npm run build` → pasta `dist/`), servido
  diretamente pelo servidor web (Nginx ou IIS), sem Node envolvido.
- **API**: processo Node/Express (`server/index.ts`, compilado para `dist-server/index.js`)
  escutando apenas em `127.0.0.1:PORT` (padrão `3001`). Nunca é exposto direto à internet —
  o servidor web faz proxy reverso de `/api/*` para ele.
- **Banco de dados**: MariaDB. Pode rodar na mesma máquina ou em servidor dedicado.
- **E-mail**: usado apenas para o fluxo de "esqueci minha senha" (SMTP externo).
- **Uploads/documentos**: os PDFs e fotos de perfil são gravados como BLOB direto no banco
  (ver `multer.memoryStorage()` em `server/index.ts`) — não há pasta de uploads no
  filesystem para gerenciar ou fazer backup separadamente do banco.

## Fluxo de atualização via Git

A ideia: você desenvolve e testa no seu computador, manda (`git push`) para um
repositório privado no GitHub ou GitLab, e depois — quando quiser publicar — entra no
servidor e roda um script que baixa e aplica essa versão. O `.env` de cada máquina
(desenvolvimento e produção) fica de fora do Git (veja `.gitignore`), então cada
ambiente guarda seus próprios segredos e nunca são sobrescritos por um `git pull`.

### Configuração única (a primeira vez)

1. **Crie um repositório privado** no GitHub ou GitLab (vazio, sem README/`.gitignore`
   automático — este projeto já tem os seus).
2. **No seu computador**, dentro da pasta do projeto (a raiz, que contém `app/`):

   ```bash
   git remote add origin <url-do-seu-repositorio>
   git push -u origin main
   ```

3. **No servidor**, siga o guia do seu sistema operacional
   ([Linux](./deploy-linux.md) ou [Windows](./deploy-windows.md)) a partir do passo
   "Obter o código e instalar dependências" — ele já usa `git clone` com essa mesma URL.

### No dia a dia (publicando uma atualização)

1. **No seu computador**: desenvolva, teste localmente (`npm run dev` + `npm run api`),
   e quando estiver pronto:

   ```bash
   git add -A
   git commit -m "descrição da mudança"
   git push origin main
   ```

2. **No servidor**: entre via SSH (Linux) ou RDP/PowerShell remoto (Windows) e rode o
   script de atualização da pasta `app/`:

   - Linux: `./deploy/linux/update.sh`
   - Windows: `.\deploy\windows\update.ps1` (PowerShell como Administrador)

   O script baixa o código (`git pull`), reinstala dependências, recompila e reinicia o
   serviço — parando para você confirmar antes de reiniciar, caso haja uma migration
   nova em `database/migrations/` para aplicar manualmente primeiro.

Isso é suficiente para um único desenvolvedor ou uma equipe pequena publicando direto na
mesma branch (`main`). Se o time crescer, o próximo passo natural é usar branches e pull
requests antes de mesclar em `main` — o fluxo de publicação no servidor continua o mesmo.

## Pré-requisitos gerais (qualquer SO)

- Node.js 20 LTS ou superior.
- MariaDB 10.11+ (ou MySQL 8+ compatível).
- Certificado TLS válido para o domínio público (Let's Encrypt é suficiente).
- Acesso de saída (outbound) na porta SMTP configurada (465 ou 587).

## Checklist antes de ir ao ar

1. **Nunca reutilize valores de desenvolvimento em produção.** O `.env` de desenvolvimento
   incluído no projeto tem uma senha de app de e-mail pessoal e uma `JWT_SECRET` fraca —
   gere valores novos e exclusivos para produção (veja `.env.production.example`).
2. **Nunca rode `database/seed-dev-users.sql`** (nem as migrations `003`/`005`) neste
   ambiente — eles criam usuários de demonstração com uma senha pública, documentada
   neste repositório. `database/schema.sql` sozinho não cria nenhum usuário. Para o
   primeiro acesso administrativo real, veja "Criando o primeiro administrador em
   produção" no `README.md`.
3. **`CORS_ORIGIN`** deve ser o domínio público real (`https://...`), nunca `*`.
4. **`JWT_SECRET`** deve ter no mínimo 32 bytes aleatórios, gerado só para este ambiente.
5. **`TRUST_PROXY=1`** no `.env` — a API roda atrás de um proxy reverso (Nginx/IIS), e sem
   isso o limitador de tentativas de login não identifica corretamente o IP de quem está
   tentando entrar.
6. **Banco**: usuário dedicado (`sis_cred`) com privilégios apenas no schema `sis_cred`,
   senha forte, sem acesso remoto exposto (bind em `127.0.0.1` a menos que a API rode em
   outra máquina).
7. **Backups do MariaDB** agendados (`mysqldump`/`mariabackup`) — é a única fonte de
   verdade, já que documentos ficam no banco.
8. **HTTPS obrigatório** no domínio público; a API roda em HTTP simples apenas em loopback,
   por trás do proxy.
9. **Logs**: acompanhe os logs do processo Node (systemd journal no Linux, `NSSM`/Event Log
   no Windows) e do servidor web.

## Variáveis de ambiente

| Variável | Obrigatória | Descrição |
|---|---|---|
| `PORT` | não (padrão `3001`) | Porta local onde a API escuta. |
| `DB_HOST` | sim | Host do MariaDB. |
| `DB_PORT` | não (padrão `3306`) | Porta do MariaDB. |
| `DB_USER` | sim | Usuário da aplicação no banco. |
| `DB_PASSWORD` | sim | Senha do usuário do banco. |
| `DB_NAME` | sim | Nome do schema (`sis_cred`). |
| `CORS_ORIGIN` | sim | Origem (domínio) autorizada a chamar a API. |
| `JWT_SECRET` | sim | Chave para assinar tokens JWT. A API recusa iniciar sem ela. |
| `JWT_EXPIRES_IN` | não (padrão `8h`) | Validade do token de sessão. |
| `SMTP_HOST` | não* | Servidor SMTP para e-mails de recuperação de senha. |
| `SMTP_PORT` | não (padrão `465`) | Porta SMTP. |
| `SMTP_USER` / `SMTP_PASS` | não* | Credenciais SMTP. |
| `SMTP_FROM` | não | Remetente exibido nos e-mails. |

\* Se `SMTP_HOST` não for definido, o envio de e-mail fica desabilitado e o recurso
"esqueci minha senha" não funciona — defina para produção.

## Build de produção

Dentro de `app/`:

```bash
npm ci
npm run build:prod
```

Isso gera:

- `dist/` — frontend estático, para ser servido pelo Nginx/IIS.
- `dist-server/index.js` — API compilada, executada com `node dist-server/index.js`
  (script `npm start`).

Os guias específicos por SO detalham como colocar cada peça em execução permanente.
