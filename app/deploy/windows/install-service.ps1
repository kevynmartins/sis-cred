<#
.SYNOPSIS
  Instala a API do Sis-Cred como Servico do Windows usando NSSM.

.DESCRIPTION
  Execute como Administrador, a partir da raiz do projeto (C:\sis-cred por padrao),
  depois de rodar "npm run build:prod" e configurar o arquivo .env.

.PARAMETER NssmPath
  Caminho completo para o executavel nssm.exe.

.PARAMETER AppDir
  Pasta raiz da aplicacao (onde estao dist-server\index.js e .env).

.PARAMETER ServiceName
  Nome do servico do Windows a ser criado.

.EXAMPLE
  .\install-service.ps1 -NssmPath "C:\Tools\nssm\nssm.exe" -AppDir "C:\sis-cred"
#>

param(
    [Parameter(Mandatory = $true)]
    [string]$NssmPath,

    [Parameter(Mandatory = $true)]
    [string]$AppDir,

    [string]$ServiceName = "SisCredApi"
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $NssmPath)) {
    throw "nssm.exe nao encontrado em '$NssmPath'. Baixe em https://nssm.cc/download"
}

$entryPoint = Join-Path $AppDir "dist-server\index.js"
if (-not (Test-Path $entryPoint)) {
    throw "'$entryPoint' nao existe. Rode 'npm run build:prod' antes de instalar o servico."
}

$nodePath = (Get-Command node -ErrorAction Stop).Source
$logDir = Join-Path $AppDir "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

if (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue) {
    Write-Host "Servico '$ServiceName' ja existe. Removendo antes de recriar..."
    & $NssmPath stop $ServiceName
    & $NssmPath remove $ServiceName confirm
}

& $NssmPath install $ServiceName $nodePath $entryPoint
& $NssmPath set $ServiceName AppDirectory $AppDir
& $NssmPath set $ServiceName AppEnvironmentExtra "NODE_ENV=production"
& $NssmPath set $ServiceName AppStdout (Join-Path $logDir "stdout.log")
& $NssmPath set $ServiceName AppStderr (Join-Path $logDir "stderr.log")
& $NssmPath set $ServiceName AppRotateFiles 1
& $NssmPath set $ServiceName AppRotateBytes 10485760
& $NssmPath set $ServiceName Start SERVICE_AUTO_START
& $NssmPath set $ServiceName AppExit Default Restart
& $NssmPath set $ServiceName AppRestartDelay 5000
& $NssmPath set $ServiceName DisplayName "Sis-Cred API"
& $NssmPath set $ServiceName Description "API Node/Express do Sis-Cred (dist-server/index.js)"

Start-Service $ServiceName
Write-Host "Servico '$ServiceName' instalado e iniciado."
Get-Service $ServiceName
