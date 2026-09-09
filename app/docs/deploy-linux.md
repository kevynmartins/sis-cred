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

O script baixa o código novo, reinstala dependências, recompila e reinicia o serviço,
avisando antes se houver migrations novas para aplicar manualmente.

## 11. Backup do banco

```bash
mysqldump -u root -p sis_cred | gzip > sis_cred_$(date +%F).sql.gz
```

Agende via `cron` (ex.: diariamente) e copie os arquivos para um destino fora do
servidor.
