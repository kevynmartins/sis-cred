<#
.SYNOPSIS
  Publica a versão mais recente do branch atual no servidor Windows: atualiza o
  código, reinstala dependências, recompila e reinicia o serviço da API + IIS.

.DESCRIPTION
  Rode este script NO SERVIDOR, dentro da pasta do projeto (ex.: C:\sis-cred),
  depois de já ter dado "git push" da sua máquina para o repositório remoto.
  Execute em um PowerShell como Administrador.

.PARAMETER ServiceName
  Nome do serviço do Windows criado pelo install-service.ps1 (padrão: SisCredApi).

.PARAMETER Port
  Porta local da API, para o teste de saúde no final (padrão: 3001).
#>
param(
  [string]$ServiceName = "SisCredApi",
  [int]$Port = 3001
)

$ErrorActionPreference = "Stop"

Write-Host "==> Baixando o código mais recente (git pull --ff-only)" -ForegroundColor Cyan
git fetch --all --prune
git pull --ff-only

Write-Host "==> Instalando dependências (npm ci)" -ForegroundColor Cyan
npm ci

Write-Host "==> Compilando frontend e API (npm run build:prod)" -ForegroundColor Cyan
npm run build:prod

Write-Host ""
Write-Host "ATENÇÃO: se este deploy incluiu novas migrations em database\migrations\," -ForegroundColor Yellow
Write-Host "aplique-as manualmente antes de continuar, se elas mudarem colunas que a" -ForegroundColor Yellow
Write-Host "nova API espera existir." -ForegroundColor Yellow
Read-Host "Pressione Enter para continuar e reiniciar o serviço (ou feche esta janela para parar aqui)" | Out-Null

Write-Host "==> Reiniciando o serviço $ServiceName" -ForegroundColor Cyan
Restart-Service -Name $ServiceName
Start-Sleep -Seconds 2
Get-Service -Name $ServiceName

Write-Host "==> Reiniciando o IIS" -ForegroundColor Cyan
iisreset | Out-Null

Write-Host "==> Verificando a saúde da API" -ForegroundColor Cyan
try {
  $response = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/api/health" -UseBasicParsing -TimeoutSec 10
  Write-Host $response.Content
  Write-Host "==> Deploy concluído com sucesso." -ForegroundColor Green
} catch {
  Write-Warning "A API não respondeu. Veja os logs em .\logs\ e o Visualizador de Eventos do Windows."
  exit 1
}
