# Deploy em servidor Linux (Ubuntu/Debian)

Pré-leitura: [`DEPLOYMENT.md`](./DEPLOYMENT.md) (arquitetura e checklist).

Testado como referência em Ubuntu Server 22.04/24.04. Os passos são equivalentes em
Debian, ajustando apenas o gerenciador de pacotes se necessário.

## 1. Pacotes base

```bash
sudo apt update
sudo apt install -y curl gnupg2 ca-certificates lsb-release ufw

# Node.js 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# MariaDB
sudo apt install -y mariadb-server mariadb-client
sudo mysql_secure_installation

# Nginx
sudo apt install -y nginx

# Certbot (TLS Let's Encrypt)
sudo apt install -y certbot python3-certbot-nginx
```

## 2. Banco de dados

```bash
sudo mariadb -u root -p
```

```sql
CREATE USER 'sis_cred'@'localhost' IDENTIFIED BY 'SENHA_FORTE_AQUI';
CREATE DATABASE IF NOT EXISTS sis_cred CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
GRANT ALL PRIVILEGES ON sis_cred.* TO 'sis_cred'@'localhost';
FLUSH PRIVILEGES;
EXIT;
```

Carregue o schema (só cria as tabelas — nenhum usuário é criado automaticamente):

```bash
mariadb -u root -p < database/schema.sql
```

## 3. Obter o código e instalar dependências

Clone o repositório que você já configurou no GitHub/GitLab (veja
["Fluxo de atualização via Git"](./DEPLOYMENT.md#fluxo-de-atualização-via-git) em
`DEPLOYMENT.md` se ainda não configurou):

```bash
sudo mkdir -p /opt/sis-cred
sudo chown $USER:$USER /opt/sis-cred
git clone <url-do-seu-repositorio> /opt/sis-cred
cd /opt/sis-cred/app
npm ci
```

A partir daqui, todos os comandos deste guia rodam dentro de `/opt/sis-cred/app`.

**Não rode `database/seed-dev-users.sql` neste servidor** — ele cria usuários com uma
senha pública, só serve para desenvolvimento local. Para criar o primeiro administrador
de produção, veja "Criando o primeiro administrador em produção" no `README.md` do
projeto.

## 4. Configurar variáveis de ambiente

```bash
cp .env.production.example .env
nano .env   # preencha DB_PASSWORD, JWT_SECRET, CORS_ORIGIN, SMTP_*, TRUST_PROXY=1
chmod 600 .env
```

Gere um `JWT_SECRET` forte:

```bash
openssl rand -base64 48
```

**Cuidado com caracteres especiais nos valores** (`SMTP_PASS`, `DB_PASSWORD` etc.): o
Node lê o `.env` com a biblioteca `dotenv`, que aceita qualquer caractere sem problema.
Mas se um valor tiver `(`, `)`, `<`, `>`, `!`, `$`, `` ` `` ou espaço sem estar entre
aspas, ele vai quebrar caso alguém tente `source .env` num script bash (uso comum para
extrair uma variável manualmente, como na seção 10.1). Coloque esses valores entre aspas
simples para evitar surpresa depois:

```bash
SMTP_PASS='a)w{7?N<[THP'
```

## 5. Build

```bash
npm run build:prod
```

Isso gera `dist/` (frontend) e `dist-server/index.js` (API).

## 6. Rodar a API como serviço (systemd)

Copie o unit file de exemplo:

```bash
sudo cp deploy/systemd/sis-cred-api.service /etc/systemd/system/sis-cred-api.service
sudo nano /etc/systemd/system/sis-cred-api.service   # confirme os caminhos e o usuário
```

Crie um usuário de sistema dedicado (sem privilégios de login/shell) para rodar o processo.
Ele só precisa de permissão de **leitura** — quem faz `git pull`/build continua sendo o seu
usuário normal, o que deixa `deploy/linux/update.sh` simples de rodar sem trocar de usuário:

```bash
sudo useradd --system --no-create-home --shell /usr/sbin/nologin siscred
sudo usermod -aG siscred "$USER"          # seu usuário entra no grupo do serviço
sudo chgrp -R siscred /opt/sis-cred
sudo chmod -R g+rX /opt/sis-cred
sudo setfacl -R -d -m g:siscred:rX /opt/sis-cred   # novos arquivos herdam a permissão de leitura
newgrp siscred                            # aplica o novo grupo nesta sessão de terminal
```

(`setfacl` vem do pacote `acl`: `sudo apt install -y acl`, caso não esteja instalado.)

Ative e inicie:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now sis-cred-api
sudo systemctl status sis-cred-api
```

Ver logs:

```bash
sudo journalctl -u sis-cred-api -f
```

Confirme que a API está respondendo localmente:

```bash
curl http://127.0.0.1:3001/api/health
```

## 7. Servir o frontend e proxy reverso (Nginx)

```bash
sudo cp deploy/nginx/sis-cred.conf /etc/nginx/sites-available/sis-cred.conf
sudo nano /etc/nginx/sites-available/sis-cred.conf   # ajuste server_name e o caminho de root
sudo ln -s /etc/nginx/sites-available/sis-cred.conf /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

## 8. HTTPS

```bash
sudo certbot --nginx -d app.suaempresa.com.br
```

O Certbot ajusta automaticamente o bloco `server` para escutar em 443 e redirecionar
HTTP → HTTPS, além de configurar a renovação automática (`certbot renew` via timer).

## 9. Firewall

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
sudo ufw status
```

A porta 3001 (API) e 3306 (MariaDB) **não** devem ser expostas externamente — apenas
Nginx (80/443) e SSH.

## 10. Atualizações

Depois de desenvolver e testar na sua máquina e dar `git push` para o repositório
remoto (veja ["Fluxo de atualização via Git"](./DEPLOYMENT.md#fluxo-de-atualização-via-git)
em `DEPLOYMENT.md`), rode no servidor:

```bash
cd /opt/sis-cred/app
chmod +x deploy/linux/update.sh   # só na primeira vez
./deploy/linux/update.sh
```

O script baixa o código novo, reinstala dependências, recompila e para, pedindo para você
apertar Enter antes de reiniciar o serviço — essa pausa existe justamente para dar tempo
de aplicar, à mão, qualquer migration nova em `database/migrations/` (o script não faz
isso sozinho, porque só você sabe se aquela migration específica já foi aplicada ou não
neste banco).

### 10.1 Passo a passo detalhado (com migration de banco)

Este é o roteiro completo, do jeito que uma atualização com mudança de schema é feita na
prática — por exemplo, a migration `016_add_deps_extracted_data.sql` (nova coluna
`extracted_data` em `dossier_documents`).

**1. Conecte por SSH e entre na pasta do projeto:**

```bash
ssh delupoti@<IP-do-servidor>
cd /opt/sis-cred
```

Prefira configurar uma **chave SSH** em vez de digitar senha toda vez (`ssh-keygen` na
sua máquina + `ssh-copy-id delupoti@<IP-do-servidor>`) — além de mais rápido, evita ter
que compartilhar a senha por chat/e-mail.

**2. Anote o commit atual (antes de atualizar) e baixe o código novo:**

```bash
COMMIT_ANTIGO=$(git rev-parse HEAD)   # guarda pra comparar migrations e pra rollback, se precisar
git fetch --all --prune
git pull --ff-only
git log --oneline -3   # confirme que o commit esperado chegou
```

**3. Veja se essa atualização trouxe alguma migration nova**, comparando com o commit que
estava rodando antes do pull:

```bash
git log -p --stat "$COMMIT_ANTIGO"..HEAD -- app/database/migrations/
```

Se a lista vier vazia, não há nada para aplicar no banco — pule direto para o passo 5.

**4. Se houver migration nova, aplique antes de recompilar/reiniciar.** Migrations deste
projeto só adicionam colunas/tabelas (nunca removem nem renomeiam nada usado pela versão
anterior), então é seguro aplicá-las primeiro, com o serviço antigo ainda rodando —
ele simplesmente ignora a coluna nova até o código novo entrar no ar.

Extraia a senha do banco do `.env` sem usar `source` (por causa da observação sobre
caracteres especiais na seção 4 — se algum valor não estiver entre aspas, `source` quebra
no meio do arquivo e pode deixar variáveis depois do erro sem valor nenhum):

```bash
cd app
DBPASS=$(grep '^DB_PASSWORD=' .env | cut -d= -f2-)
mariadb -h 127.0.0.1 -P 3306 -u sis_cred -p"$DBPASS" sis_cred \
  < database/migrations/016_add_deps_extracted_data.sql
```

Confira que a mudança realmente entrou:

```bash
mariadb -h 127.0.0.1 -P 3306 -u sis_cred -p"$DBPASS" sis_cred -e 'DESCRIBE dossier_documents;'
unset DBPASS   # não deixe a senha na variável de ambiente da sessão depois de usar
```

**5. Reinstale dependências e recompile:**

```bash
npm ci
npm run build:prod
```

**6. Reinicie o serviço e acompanhe o start:**

```bash
sudo systemctl restart sis-cred-api
sleep 2
sudo systemctl --no-pager --lines=10 status sis-cred-api
```

Confirme que está `active (running)` e sem erros nas últimas linhas de log. Se algo
parecer errado, veja o log completo:

```bash
sudo journalctl -u sis-cred-api -n 80
```

**7. Confirme que a API responde:**

```bash
curl -fsS http://127.0.0.1:3001/api/health
# esperado: {"status":"ok","database":"mariadb"}
```

Se a resposta vier `ok`, o deploy terminou. Teste também pelo navegador, no domínio
público, fazendo login e conferindo a funcionalidade que mudou nesta versão.

**Se algo der errado depois do restart** (API não sobe, erro 500 nas telas que usam a
tabela alterada): o log do `journalctl` quase sempre aponta a causa. Em último caso, para
voltar ao código anterior enquanto investiga (a migration em si, sendo aditiva, não
precisa ser desfeita):

```bash
git reset --hard "$COMMIT_ANTIGO"   # a variável guardada no passo 2, se ainda for o mesmo terminal
npm ci && npm run build:prod
sudo systemctl restart sis-cred-api
```

(Se já fechou o terminal e perdeu a variável, veja o commit anterior em `git log --oneline`
antes de rodar o `git pull` — ou peça pra quem tem essa anotação.)

## 11. Backup do banco

```bash
mysqldump -u root -p sis_cred | gzip > sis_cred_$(date +%F).sql.gz
```

Agende via `cron` (ex.: diariamente) e copie os arquivos para um destino fora do
servidor.
