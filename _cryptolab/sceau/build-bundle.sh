#!/usr/bin/env bash
# Régénère le bundle navigateur auto-hébergé de @cloudflare/voprf-ts pour SCEAU.
# Produit workers/src/routes/_sceau-voprf.js (base64 byte-exact + SRI sha384).
# À relancer si on bump la version de voprf-ts. Lancer depuis workers/.
set -euo pipefail
cd "$(dirname "$0")/../../workers"

# Bundle IIFE (global window.SceauVOPRF) pour pouvoir l'épingler en SRI via
# <script src integrity> (le SRI ne s'applique PAS aux import de module ESM).
printf "import { Oprf, VOPRFClient, Evaluation } from '@cloudflare/voprf-ts';\nexport { Oprf, VOPRFClient, Evaluation };\n" > _sceau_entry.mjs
npx --yes esbuild _sceau_entry.mjs --bundle --format=iife --global-name=SceauVOPRF --minify \
  --platform=browser --target=es2020 --outfile=/tmp/voprf.iife.js
rm -f _sceau_entry.mjs

SRI="sha384-$(openssl dgst -sha384 -binary /tmp/voprf.iife.js | openssl base64 -A)"
B64=$(openssl base64 -A -in /tmp/voprf.iife.js)
VER=$(node -p "require('@cloudflare/voprf-ts/package.json').version" 2>/dev/null || echo "unknown")

{
  printf '/* SCEAU · bundle navigateur @cloudflare/voprf-ts (auto-hébergé). SRI: %s */\n' "$SRI"
  printf 'export const VOPRF_BUNDLE_VERSION = "%s";\n' "$VER"
  printf 'export const VOPRF_BUNDLE_SRI = "%s";\n' "$SRI"
  printf 'export const VOPRF_BUNDLE_B64 = "%s";\n' "$B64"
} > src/routes/_sceau-voprf.js

echo "OK -> src/routes/_sceau-voprf.js (SRI $SRI)"
