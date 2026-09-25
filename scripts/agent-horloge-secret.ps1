# Creer le secret de l'horloge de l'agent et le ranger dans le Vault du hub.
#
# Louis le lance lui-meme depuis la racine du hub (PowerShell 5.1) :
#   .\scripts\agent-horloge-secret.ps1
#
# Le script tire 32 octets au hasard (64 caracteres hexadecimaux), les range
# dans le Vault par `agent_horloge_regler` (migration 0039), avec l'adresse de
# la route de production, puis les met dans le presse-papiers pour la
# variable AGENT_HORLOGE_SECRET de Vercel. Le secret ne s'affiche jamais :
# seulement sa longueur et ses 4 derniers caracteres, a comparer avec Vercel.
# Le presse-papiers est vide a la fin.

param(
  [string]$Adresse = "https://app.cometestudio.fr/api/agent/horloge"
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path ".env.local")) { throw "Lance ce script depuis la racine du hub (.env.local introuvable)." }

$conf = @{}
Get-Content ".env.local" | ForEach-Object {
  if ($_ -match '^\s*([^#=][^=]*)=(.*)$') { $conf[$matches[1].Trim()] = $matches[2].Trim().Trim('"').Trim("'") }
}
$url = $conf["NEXT_PUBLIC_SUPABASE_URL"]
$service = $conf["SUPABASE_SERVICE_ROLE_KEY"]
if (-not $url -or -not $service) { throw "NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY manque dans .env.local." }

$octets = New-Object byte[] 32
$tirage = [Security.Cryptography.RandomNumberGenerator]::Create()
$tirage.GetBytes($octets)
$tirage.Dispose()
$secret = -join ($octets | ForEach-Object { $_.ToString("x2") })
$octets = $null

$entetes = @{ apikey = $service; Authorization = "Bearer $service" }
$corps = @{ url = $Adresse; secret = $secret } | ConvertTo-Json -Compress
Invoke-RestMethod -Method Post -Uri "$url/rest/v1/rpc/agent_horloge_regler" -Headers $entetes `
  -ContentType "application/json" -Body ([Text.Encoding]::UTF8.GetBytes($corps)) | Out-Null
$corps = $null

Write-Host "Range dans le Vault du hub (adresse : $Adresse)."
Write-Host ("Longueur : {0}" -f $secret.Length)
Write-Host ("4 derniers caracteres : {0}" -f $secret.Substring($secret.Length - 4))

Set-Clipboard -Value $secret
$secret = $null
Write-Host ""
Write-Host "Le secret est dans le presse-papiers."
Write-Host "Colle-le dans Vercel : variable AGENT_HORLOGE_SECRET, environnement Production."
Read-Host "Appuie sur Entree une fois colle dans Vercel (le presse-papiers sera vide)" | Out-Null
Set-Clipboard -Value " "
Write-Host "Presse-papiers vide."
