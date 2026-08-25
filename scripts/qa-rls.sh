#!/usr/bin/env bash
# ===========================================================================
# QA du modèle d'accès, à deux comptes — CLAUDE.md §7, annexe D du brief phase 1.
#
# Crée deux comptes et deux organisations jetables, active un outil pour l'un
# seulement, vérifie que chacun ne voit que le sien, puis supprime tout. Le
# nettoyage tourne même si le script échoue en cours de route (trap EXIT).
#
#   bash scripts/qa-rls.sh
#
# Aucune valeur sensible dans ce fichier. Les clés Supabase sont lues depuis
# .env.local (jamais versionné). Les mots de passe des comptes de test viennent
# de l'environnement (QA_PASSWORD_A / QA_PASSWORD_B, que tu peux poser dans
# .env.local) ; à défaut, le script en tire deux au hasard à chaque exécution.
# Les adresses sont surchargeables par QA_EMAIL_A / QA_EMAIL_B ; elles pointent
# par défaut sur example.com, domaine réservé à la documentation, et aucun email
# n'est envoyé (les comptes naissent déjà confirmés via l'API admin).
# ===========================================================================
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 1

[ -f .env.local ] || { echo "Abandon : .env.local introuvable à la racine du repo."; exit 1; }
set -a; . ./.env.local; set +a

: "${NEXT_PUBLIC_SUPABASE_URL:?manquant dans .env.local}"
: "${NEXT_PUBLIC_SUPABASE_ANON_KEY:?manquant dans .env.local}"
: "${SUPABASE_SERVICE_ROLE_KEY:?manquant dans .env.local}"

SB="$NEXT_PUBLIC_SUPABASE_URL"
SRK="$SUPABASE_SERVICE_ROLE_KEY"
AK="$NEXT_PUBLIC_SUPABASE_ANON_KEY"

rand_pw() { node -e "console.log('Qa1!'+require('crypto').randomBytes(12).toString('base64url'))"; }

EMA="${QA_EMAIL_A:-qa-alpha@example.com}"
EMB="${QA_EMAIL_B:-qa-bravo@example.com}"
PWA="${QA_PASSWORD_A:-$(rand_pw)}"
PWB="${QA_PASSWORD_B:-$(rand_pw)}"
[ -n "${QA_PASSWORD_A:-}" ] || echo "(mots de passe de test tirés au hasard pour cette exécution)"

jq_() { node -e "
let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
  try{const j=JSON.parse(s);const v=eval('j'+process.argv[1]);
      console.log(v===undefined||v===null?'':(typeof v==='object'?JSON.stringify(v):String(v)));}
  catch(e){console.log('ERR:'+s.slice(0,160));}
});" "$1"; }

srv() { curl -s -X "$1" "$SB/rest/v1/$2" -H "apikey: $SRK" -H "Authorization: Bearer $SRK" \
             -H "Content-Type: application/json" -H "Prefer: return=representation" ${3:+-d "$3"}; }
as()  { curl -s -X "$2" "$SB/rest/v1/$3" -H "apikey: $AK" -H "Authorization: Bearer $1" \
             -H "Content-Type: application/json" -H "Prefer: return=representation" ${4:+-d "$4"}; }
rpc() { curl -s -X POST "$SB/rest/v1/rpc/$2" -H "apikey: $AK" -H "Authorization: Bearer $1" \
             -H "Content-Type: application/json" -d "$3"; }

UA=""; UB=""; OA=""; OB=""

cleanup() {
  echo ""
  echo "=== Nettoyage ==="
  for o in "$OA" "$OB"; do
    [ -n "$o" ] && srv DELETE "organizations?id=eq.$o" > /dev/null
  done
  for u in "$UA" "$UB"; do
    [ -n "$u" ] && curl -s -X DELETE "$SB/auth/v1/admin/users/$u" \
      -H "apikey: $SRK" -H "Authorization: Bearer $SRK" > /dev/null
  done
  echo -n "organisations restantes : "; srv GET "organizations?select=slug" | jq_ ""
  echo -n "profils restants        : "; srv GET "profiles?select=email" | jq_ ""
  echo -n "appartenances restantes : "; srv GET "memberships?select=user_id" | jq_ ""
  echo -n "catalogue intact        : "; srv GET "tools?select=slug,name" | jq_ ""
}
trap cleanup EXIT

echo "=== 1. Création des comptes (API admin, aucun email envoyé) ==="
UA=$(curl -s -X POST "$SB/auth/v1/admin/users" -H "apikey: $SRK" -H "Authorization: Bearer $SRK" \
     -H "Content-Type: application/json" \
     -d "{\"email\":\"$EMA\",\"password\":\"$PWA\",\"email_confirm\":true,\"user_metadata\":{\"full_name\":\"QA Alpha\"}}" | jq_ ".id")
UB=$(curl -s -X POST "$SB/auth/v1/admin/users" -H "apikey: $SRK" -H "Authorization: Bearer $SRK" \
     -H "Content-Type: application/json" \
     -d "{\"email\":\"$EMB\",\"password\":\"$PWB\",\"email_confirm\":true,\"user_metadata\":{\"full_name\":\"QA Bravo\"}}" | jq_ ".id")
case "$UA$UB" in
  *ERR*|"") echo "Abandon : création des comptes impossible (comptes déjà présents ?). A=$UA B=$UB"; exit 1;;
esac
echo "user A = $UA"
echo "user B = $UB"

echo "=== 2. Trigger handle_new_user : les profils existent-ils ? ==="
srv GET "profiles?select=id,email,full_name,is_admin&id=in.($UA,$UB)" | jq_ ""

echo "=== 3. Organisations + appartenances + activation kanban pour A seulement ==="
OA=$(srv POST "organizations" "{\"name\":\"QA Alpha\",\"slug\":\"qa-alpha\"}" | jq_ "[0].id")
OB=$(srv POST "organizations" "{\"name\":\"QA Bravo\",\"slug\":\"qa-bravo\"}" | jq_ "[0].id")
echo "org A = $OA"
echo "org B = $OB"
srv POST "memberships" "{\"organization_id\":\"$OA\",\"user_id\":\"$UA\",\"role\":\"owner\"}" > /dev/null
srv POST "memberships" "{\"organization_id\":\"$OB\",\"user_id\":\"$UB\",\"role\":\"owner\"}" > /dev/null
KID=$(srv GET "tools?slug=eq.kanban&select=id" | jq_ "[0].id")
srv POST "organization_tools" "{\"organization_id\":\"$OA\",\"tool_id\":\"$KID\"}" > /dev/null
echo "kanban activé pour A uniquement (tool $KID)"

echo "=== 4. Sessions ==="
TA=$(curl -s -X POST "$SB/auth/v1/token?grant_type=password" -H "apikey: $AK" -H "Content-Type: application/json" \
     -d "{\"email\":\"$EMA\",\"password\":\"$PWA\"}" | jq_ ".access_token")
TB=$(curl -s -X POST "$SB/auth/v1/token?grant_type=password" -H "apikey: $AK" -H "Content-Type: application/json" \
     -d "{\"email\":\"$EMB\",\"password\":\"$PWB\"}" | jq_ ".access_token")
echo "session A : ${TA:0:12}...  session B : ${TB:0:12}..."

echo ""
echo "=== 5. Ce que voit A ==="
echo -n "organizations      : "; as "$TA" GET "organizations?select=slug" | jq_ ""
echo -n "memberships        : "; as "$TA" GET "memberships?select=organization_id,role" | jq_ ""
echo -n "organization_tools : "; as "$TA" GET "organization_tools?select=organization_id,enabled" | jq_ ""
echo -n "profiles           : "; as "$TA" GET "profiles?select=email" | jq_ ""
echo -n "tools (catalogue)  : "; as "$TA" GET "tools?select=slug" | jq_ ""

echo ""
echo "=== 6. Ce que voit B ==="
echo -n "organizations      : "; as "$TB" GET "organizations?select=slug" | jq_ ""
echo -n "memberships        : "; as "$TB" GET "memberships?select=organization_id,role" | jq_ ""
echo -n "organization_tools : "; as "$TB" GET "organization_tools?select=organization_id,enabled" | jq_ ""
echo -n "profiles           : "; as "$TB" GET "profiles?select=email" | jq_ ""

echo ""
echo "=== 7. Fonctions d'accès ==="
echo -n "B is_admin              : "; rpc "$TB" is_admin '{}'; echo ""
echo -n "B is_member(org A)      : "; rpc "$TB" is_member "{\"org\":\"$OA\"}"; echo ""
echo -n "B is_member(org B)      : "; rpc "$TB" is_member "{\"org\":\"$OB\"}"; echo ""
echo -n "B has_tool(org A,kanban): "; rpc "$TB" has_tool "{\"org\":\"$OA\",\"tool_slug\":\"kanban\"}"; echo ""
echo -n "A has_tool(org A,kanban): "; rpc "$TA" has_tool "{\"org\":\"$OA\",\"tool_slug\":\"kanban\"}"; echo ""
echo -n "A has_tool(org B,kanban): "; rpc "$TA" has_tool "{\"org\":\"$OB\",\"tool_slug\":\"kanban\"}"; echo ""

echo ""
echo "=== 8. Tentatives d'écriture interdites ==="
echo -n "B renomme son organisation : "; as "$TB" PATCH "organizations?id=eq.$OB" '{"name":"pirate"}' | jq_ ""
echo -n "B s'ajoute à l'org de A    : "; as "$TB" POST "memberships" "{\"organization_id\":\"$OA\",\"user_id\":\"$UB\"}" | jq_ ".message"
echo -n "B se promeut admin         : "; as "$TB" PATCH "profiles?id=eq.$UB" '{"is_admin":true}' | jq_ ".message"
echo -n "B change son nom (permis)  : "; as "$TB" PATCH "profiles?id=eq.$UB" '{"full_name":"QA Bravo bis"}' | jq_ "[0].full_name"
echo -n "B active kanban chez lui   : "; as "$TB" POST "organization_tools" "{\"organization_id\":\"$OB\",\"tool_id\":\"$KID\"}" | jq_ ".message"
echo -n "B modifie le catalogue     : "; as "$TB" PATCH "tools?slug=eq.kanban" '{"name":"pirate"}' | jq_ ""
echo -n "is_admin toujours false ?  : "; srv GET "profiles?select=is_admin&id=eq.$UB" | jq_ "[0].is_admin"
