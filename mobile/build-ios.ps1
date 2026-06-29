# Build iOS do app 21 Go Rastreamento.
# Carrega as credenciais do .env.local e dispara o build na nuvem (EAS).
# A 1a vez cria o certificado de distribuicao (responda Y quando perguntar).
# Depois disso, os proximos builds podem rodar automaticamente.

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

Write-Host "Carregando credenciais do .env.local..." -ForegroundColor Cyan
Get-Content "..\.env.local" | ForEach-Object {
  if ($_ -match '^(EXPO_[A-Z_]+)=(.*)$') {
    [Environment]::SetEnvironmentVariable($matches[1], $matches[2].Trim(), 'Process')
  }
}
$env:EAS_BUILD_NO_EXPO_GO_WARNING = "true"

Write-Host "Conta Expo conectada:" -ForegroundColor Cyan
npx eas-cli whoami

Write-Host ""
Write-Host "==================================================================" -ForegroundColor Yellow
Write-Host " Iniciando o build do iOS na nuvem." -ForegroundColor Yellow
Write-Host " - 'Generate a new Apple Distribution Certificate?' -> Y"          -ForegroundColor Yellow
Write-Host " - 'Generate a new Apple Provisioning Profile?'    -> Y"          -ForegroundColor Yellow
Write-Host " - Se pedir LOGIN da Apple: use marketing21goprotpatri@gmail.com" -ForegroundColor Yellow
Write-Host "   + sua senha Apple + o codigo de verificacao (2FA) do iPhone."  -ForegroundColor Yellow
Write-Host "==================================================================" -ForegroundColor Yellow
Write-Host ""

npx eas-cli build --platform ios --profile production

Write-Host ""
Write-Host "Pronto! Se o build foi enfileirado, acompanhe o link acima." -ForegroundColor Green
