# Ranger un jeton de l'agent dans le Vault du hub, sans qu'il s'affiche.
#
# Louis le lance lui-même depuis la racine du hub (PowerShell 5.1) :
#   .\scripts\agent-ranger-jeton.ps1                      # jeton Calendly de Peggy
#   .\scripts\agent-ranger-jeton.ps1 -Client peggy -Type whatsapp_token
#
# Le jeton se tape en saisie masquée (Read-Host -AsSecureString) : il ne passe
# ni par l'écran, ni par l'historique PowerShell, ni par la conversation avec
# Claude. La vérification n'affiche que des nombres et des oui/non. Il part
# dans le Vault par `agent_set_secret` (migration 0033), avec la clé de
# service lue dans `.env.local`.

param(
  [string]$Client = "peggy",
  [ValidateSet("calendly_token", "whatsapp_token")]
  [string]$Type = "calendly_token"
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

$entetes = @{ apikey = $service; Authorization = "Bearer $service" }
$org = @(Invoke-RestMethod -Uri "$url/rest/v1/organizations?select=id,name&slug=eq.$Client" -Headers $entetes)
if ($org.Count -ne 1) { throw "Client introuvable dans le hub : $Client" }

$secret = Read-Host "Colle le jeton ($Type) puis Entrée (rien ne s'affiche)" -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
try { $jeton = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr).Trim() }
finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }

Write-Host ("Longueur : {0}" -f $jeton.Length)
if ($jeton.Length -ge 4) { Write-Host ("4 derniers caracteres : {0}" -f $jeton.Substring($jeton.Length - 4)) }
Write-Host ("Commence par eyJ (forme d'un jeton Calendly) : {0}" -f $jeton.StartsWith("eyJ"))
Write-Host ("Contient un espace ou un chevron : {0}" -f ($jeton -match '[\s<>]'))

if ($jeton.Length -lt 40 -or $jeton -match '[\s<>]') {
  $jeton = $null
  throw "Forme inattendue : rien n'a ete range. Recommence en collant le jeton seul."
}

$corps = @{ org = $org[0].id; kind = $Type; value = $jeton } | ConvertTo-Json -Compress
$jeton = $null
Invoke-RestMethod -Method Post -Uri "$url/rest/v1/rpc/agent_set_secret" -Headers $entetes `
  -ContentType "application/json" -Body ([Text.Encoding]::UTF8.GetBytes($corps)) | Out-Null
$corps = $null

Write-Host ("Range dans le Vault du hub pour {0} ({1})." -f $org[0].name, $Type)
