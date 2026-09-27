# Enregistrer le numéro WhatsApp de l'agent auprès de l'API Cloud de Meta.
#
# Louis le lance lui-même depuis la racine du hub (PowerShell 5.1) :
#   .\scripts\agent-enregistrer-numero.ps1                       # numéro de Peggy
#   .\scripts\agent-enregistrer-numero.ps1 -NumeroId 1327291337134730
#
# Le code PIN à 6 chiffres (vérification en deux étapes du numéro) se tape
# deux fois en saisie masquée : il ne passe ni par l'écran, ni par
# l'historique PowerShell, ni par la conversation avec Claude. Louis le range
# lui-même dans son gestionnaire de mots de passe : il sera redemandé si le
# numéro doit être enregistré de nouveau. Le jeton WhatsApp de l'agent est lu
# dans le Vault du hub (`agent_get_secret`), jamais affiché.
#
# Un refus de Meta s'affiche avec sa raison (titre et message), pas seulement
# son code (proposition 199 du vault).

param(
  [string]$Client = "peggy",
  [string]$NumeroId = "1327291337134730"
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

function Lire-Masque([string]$invite) {
  $s = Read-Host $invite -AsSecureString
  $b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b).Trim() }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b) }
}

$pin = Lire-Masque "Code PIN a 6 chiffres (rien ne s'affiche)"
$pin2 = Lire-Masque "Le meme code, une seconde fois"
Write-Host ("6 chiffres : {0}" -f ($pin -match '^\d{6}$'))
$identiques = ($pin -eq $pin2)
Write-Host ("Les deux saisies sont identiques : {0}" -f $identiques)
$pin2 = $null
if (-not $identiques) { $pin = $null; throw "Les deux saisies different : rien n'a ete envoye." }
if ($pin -notmatch '^\d{6}$') { $pin = $null; throw "Il faut exactement 6 chiffres : rien n'a ete envoye." }

$corpsJeton = @{ org = $org[0].id; kind = "whatsapp_token" } | ConvertTo-Json -Compress
$jeton = Invoke-RestMethod -Method Post -Uri "$url/rest/v1/rpc/agent_get_secret" -Headers $entetes `
  -ContentType "application/json" -Body ([Text.Encoding]::UTF8.GetBytes($corpsJeton))
if (-not $jeton) { $pin = $null; throw "Jeton WhatsApp introuvable dans le Vault : lancer d'abord agent-ranger-jeton.ps1 -Type whatsapp_token." }

$corps = @{ messaging_product = "whatsapp"; pin = $pin } | ConvertTo-Json -Compress
$pin = $null
$meta = @{ Authorization = "Bearer $jeton"; "User-Agent" = "comete-hub-agent/1.0" }
try {
  $r = Invoke-RestMethod -Method Post -Uri "https://graph.facebook.com/v25.0/$NumeroId/register" -Headers $meta `
    -ContentType "application/json" -Body ([Text.Encoding]::UTF8.GetBytes($corps))
  Write-Host ("Enregistrement accepte par Meta : {0}" -f [bool]$r.success)
} catch {
  $detail = $_.ErrorDetails.Message
  if ($detail) {
    $e = ($detail | ConvertFrom-Json).error
    Write-Host ("REFUS de Meta : {0} (code {1}) : {2}" -f $e.type, $e.code, $e.message)
    if ($e.error_user_msg) { Write-Host ("  {0}" -f $e.error_user_msg) }
  } else {
    Write-Host ("REFUS : {0}" -f $_.Exception.Message)
  }
} finally {
  $corps = $null
  $jeton = $null
}

Write-Host "Pense a ranger le code PIN dans ton gestionnaire de mots de passe."
