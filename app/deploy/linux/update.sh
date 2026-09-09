#!/usr/bin/env bash
# Publica a versão mais recente do branch atual no servidor: atualiza o código,
# reinstala dependências, recompila e reinicia o serviço da API.
#
# Rode este script NO SERVIDOR, dentro da pasta do projeto (ex.: /opt/sis-cred),
# depois de já ter dado `git push` da sua máquina para o repositório remoto.
#
# Uso: ./deploy/linux/update.sh
# Variáveis opcionais: SERVICE_NAME (padrão sis-cred-api), PORT (padrão 3001)

set -euo pipefail

SERVICE_NAME="${SERVICE_NAME:-sis-cred-api}"
PORT="${PORT:-3001}"

echo "==> Baixando o código mais recente (git pull --ff-only)"
git fetch --all --prune
git pull --ff-only

echo "==> Instalando dependências (npm ci)"
npm ci

echo "==> Compilando frontend e API (npm run build:prod)"
npm run build:prod

echo "==> ATENÇÃO: se este deploy incluiu novas migrations em database/migrations/,"
echo "    aplique-as manualmente (mariadb -u root -p sis_cred < database/migrations/XXX.sql)"
echo "    antes de continuar, se elas mudarem colunas que a nova API espera existir."
read -r -p "Pressione Enter para continuar e reiniciar o serviço, ou Ctrl+C para parar aqui... "

echo "==> Reiniciando o serviço $SERVICE_NAME"
sudo systemctl restart "$SERVICE_NAME"
sleep 2
sudo systemctl --no-pager --lines=10 status "$SERVICE_NAME"

echo "==> Verificando a saúde da API"
if curl -fsS "http://127.0.0.1:${PORT}/api/health"; then
  echo
  echo "==> Deploy concluído com sucesso."
else
  echo
  echo "==> A API não respondeu. Veja os logs: sudo journalctl -u $SERVICE_NAME -n 80"
  exit 1
fi
