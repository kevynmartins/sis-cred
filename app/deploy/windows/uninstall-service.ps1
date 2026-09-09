<#
.SYNOPSIS
  Remove o Servico do Windows da API do Sis-Cred instalado via install-service.ps1.

.EXAMPLE
  .\uninstall-service.ps1 -NssmPath "C:\Tools\nssm\nssm.exe"
#>

param(
    [Parameter(Mandatory = $true)]
    [string]$NssmPath,

    [string]$ServiceName = "SisCredApi"
)

$ErrorActionPreference = "Stop"

if (-not (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue)) {
    Write-Host "Servico '$ServiceName' nao esta instalado."
    exit 0
}

& $NssmPath stop $ServiceName
& $NssmPath remove $ServiceName confirm
Write-Host "Servico '$ServiceName' removido."
