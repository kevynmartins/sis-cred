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

## Pré-requisitos gerais (qualquer SO)

- Node.js 20 LTS ou superior.
- MariaDB 10.11+ (ou MySQL 8+ compatível).
- Certificado TLS válido para o domínio público (Let's Encrypt é suficiente).
- Acesso de saída (outbound) na porta SMTP configurada (465 ou 587).

## Checklist antes de ir ao ar

1. **Nunca reutilize valores de desenvolvimento em produção.** O `.env` de desenvolvimento
   incluído no projeto tem uma senha de app de e-mail pessoal e uma `JWT_SECRET` fraca —
   gere valores novos e exclusivos para produção (veja `.env.production.example`).
2. **Troque os usuários semeados.** `database/schema.sql` cria 4 usuários de demonstração
   (`admin@empresa.com.br` e mais 3) com a senha `Sis@Cred123`. Antes de liberar o acesso:
   - Apague os usuários de demonstração que não forem reais, ou
   - Troque a senha de todos usando o fluxo "Esqueci minha senha" (requer SMTP configurado)
     ou atualizando `password_hash` diretamente no banco com um hash bcrypt novo.
3. **`CORS_ORIGIN`** deve ser o domínio público real (`https://...`), nunca `*`.
4. **`JWT_SECRET`** deve ter no mínimo 32 bytes aleatórios, gerado só para este ambiente.
5. **Banco**: usuário dedicado (`sis_cred`) com privilégios apenas no schema `sis_cred`,
   senha forte, sem acesso remoto exposto (bind em `127.0.0.1` a menos que a API rode em
   outra máquina).
6. **Backups do MariaDB** agendados (`mysqldump`/`mariabackup`) — é a única fonte de
   verdade, já que documentos ficam no banco.
7. **HTTPS obrigatório** no domínio público; a API roda em HTTP simples apenas em loopback,
   por trás do proxy.
8. **Logs**: acompanhe os logs do processo Node (systemd journal no Linux, `NSSM`/Event Log
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
