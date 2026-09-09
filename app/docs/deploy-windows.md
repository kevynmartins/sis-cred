# Deploy em Windows Server

Pré-leitura: [`DEPLOYMENT.md`](./DEPLOYMENT.md) (arquitetura e checklist).

Abordagem: **IIS** serve o frontend estático e faz proxy reverso para a **API Node**,
que roda em segundo plano como **Serviço do Windows** via **NSSM**. Testado como
referência em Windows Server 2019/2022.

## 1. Pré-requisitos

1. **Node.js 20 LTS** — instale o `.msi` de https://nodejs.org (marque "add to PATH").
2. **MariaDB para Windows** — instale o `.msi` de https://mariadb.org/download. Anote a
   senha de root definida no instalador.
3. **IIS** com os módulos de proxy reverso:
   - Ative o recurso via PowerShell (executar como Administrador):
     ```powershell
     Install-WindowsFeature -Name Web-Server, Web-Http-Redirect, Web-Stat-Compression
     ```
   - Instale o **Application Request Routing (ARR)** e o **URL Rewrite Module**
     (baixe do IIS.net / Microsoft Web Platform Installer):
     - URL Rewrite: https://www.iis.net/downloads/microsoft/url-rewrite
     - ARR 3.0: https://www.iis.net/downloads/microsoft/application-request-routing
4. **NSSM** (Non-Sucking Service Manager) para rodar o Node como serviço:
   - Baixe em https://nssm.cc/download e extraia `nssm.exe` (versão `win64`) para,
     por exemplo, `C:\Tools\nssm\nssm.exe`.

## 2. Banco de dados

Abra o **HeidiSQL** (instalado junto com o MariaDB) ou o `mysql`/`mariadb` client:

```sql
CREATE USER 'sis_cred'@'localhost' IDENTIFIED BY 'SENHA_FORTE_AQUI';
CREATE DATABASE IF NOT EXISTS sis_cred CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
GRANT ALL PRIVILEGES ON sis_cred.* TO 'sis_cred'@'localhost';
FLUSH PRIVILEGES;
```

Carregue o schema (via PowerShell, na pasta do projeto; só cria as tabelas — nenhum
usuário é criado automaticamente):

```powershell
Get-Content .\database\schema.sql -Raw | & "C:\Program Files\MariaDB 11.x\bin\mariadb.exe" -u root -p
```

## 3. Obter o código e instalar dependências

Clone o repositório que você já configurou no GitHub/GitLab (veja
["Fluxo de atualização via Git"](./DEPLOYMENT.md#fluxo-de-atualização-via-git) em
`DEPLOYMENT.md` se ainda não configurou):

```powershell
git clone <url-do-seu-repositorio> C:\sis-cred
Set-Location C:\sis-cred\app
npm ci
```

A partir daqui, todos os comandos deste guia rodam dentro de `C:\sis-cred\app`.

**Não rode `database\seed-dev-users.sql` neste servidor** — ele cria usuários com uma
senha pública, só serve para desenvolvimento local. Para criar o primeiro administrador
de produção, veja "Criando o primeiro administrador em produção" no `README.md` do
projeto.

## 4. Configurar variáveis de ambiente

```powershell
Copy-Item .env.production.example .env
notepad .env   # preencha DB_PASSWORD, JWT_SECRET, CORS_ORIGIN, SMTP_*, TRUST_PROXY=1
```

Gere um `JWT_SECRET` forte:

```powershell
[Convert]::ToBase64String((1..48 | ForEach-Object { Get-Random -Maximum 256 }))
```

## 5. Build

```powershell
npm run build:prod
```

Gera `dist\` (frontend) e `dist-server\index.js` (API).

## 6. Instalar a API como Serviço do Windows (NSSM)

Use o script pronto em `deploy\windows\install-service.ps1` (execute como Administrador,
em um PowerShell aberto **dentro** de `C:\sis-cred\app`, ajustando o caminho do `nssm.exe`
se necessário):

```powershell
.\deploy\windows\install-service.ps1 -NssmPath "C:\Tools\nssm\nssm.exe" -AppDir "C:\sis-cred\app"
```

O script:

- Cria o serviço `SisCredApi` apontando para `node.exe dist-server\index.js`.
- Configura reinício automático em caso de falha.
- Redireciona stdout/stderr para `C:\sis-cred\app\logs\`.
- Inicia o serviço.

Verifique:

```powershell
Get-Service SisCredApi
Invoke-WebRequest http://127.0.0.1:3001/api/health
```

Para remover o serviço depois (ex.: antes de reinstalar), use
`deploy\windows\uninstall-service.ps1`.

## 7. Site no IIS (frontend + proxy reverso)

1. No **Gerenciador do IIS**, crie um novo site:
   - Nome: `Sis-Cred`
   - Caminho físico: `C:\sis-cred\app\dist`
   - Binding: porta 80 (e 443 depois de instalar o certificado).
2. Copie `deploy\windows\web.config` para dentro de `C:\sis-cred\app\dist\web.config`
   (o arquivo já contém as regras de proxy reverso para `/api/*` e o fallback de SPA).
3. No **ARR**, habilite o proxy: **Server Proxy Settings** → marque **Enable proxy**.
4. **Importante para a atualização em tempo real (sem F5):** ainda em **Server Proxy
   Settings**, zere o **Response Buffer Threshold** e aumente o **Time-out** (ex.: 3600
   segundos). O `web.config` já tenta configurar isso via `<proxy>`, mas em algumas
   versões do IIS/ARR só é possível pela interface, no nível do servidor. Sem isso, a
   API funciona normalmente, só a atualização automática das telas fica instável.
5. Reinicie o site (`iisreset` ou pelo Gerenciador do IIS).

Teste acessando `http://localhost/` (frontend) e `http://localhost/api/health` (API via
proxy).

## 8. HTTPS

Opções mais comuns:

- **Certificado próprio da empresa/CA interna**: importe o `.pfx` em
  **Certificados do Servidor** no IIS e adicione um binding HTTPS (443) ao site.
- **Let's Encrypt gratuito**: use o [win-acme](https://www.win-acme.com/) (`wacs.exe`),
  que integra automaticamente com o IIS e renova o certificado periodicamente.

Depois de configurar o binding HTTPS, adicione um redirecionamento HTTP → HTTPS via
regra do URL Rewrite (ou marque a opção equivalente no win-acme, que já oferece isso).

## 9. Firewall do Windows

```powershell
New-NetFirewallRule -DisplayName "HTTP" -Direction Inbound -Protocol TCP -LocalPort 80 -Action Allow
New-NetFirewallRule -DisplayName "HTTPS" -Direction Inbound -Protocol TCP -LocalPort 443 -Action Allow
```

Não crie regra de entrada para a porta 3001 (API) nem 3306 (MariaDB) — elas devem
permanecer acessíveis apenas localmente.

## 10. Atualizações

Depois de desenvolver e testar na sua máquina e dar `git push` para o repositório
remoto (veja ["Fluxo de atualização via Git"](./DEPLOYMENT.md#fluxo-de-atualização-via-git)
em `DEPLOYMENT.md`), abra um PowerShell **como Administrador** no servidor e rode:

```powershell
Set-Location C:\sis-cred\app
.\deploy\windows\update.ps1
```

O script baixa o código novo, reinstala dependências, recompila, reinicia o serviço e o
IIS, avisando antes se houver migrations novas para aplicar manualmente.

## 11. Backup do banco

```powershell
& "C:\Program Files\MariaDB 11.x\bin\mysqldump.exe" -u root -p sis_cred > "C:\backups\sis_cred_$(Get-Date -Format yyyy-MM-dd).sql"
```

Agende via **Agendador de Tarefas do Windows** e copie os backups para um destino fora
do servidor.
