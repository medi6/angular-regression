#!/usr/bin/env bash
# Verifie que le patch angular-core-signal-dedup.patch corrige la regression.
# Usage: ./verify-patch.sh [version]   (defaut: 22.1.7)
set -u
cd "$(dirname "$0")"
V="${1:-22.1.7}"
D="versions/$V"
F="$D/node_modules/@angular/core/fesm2022/_effect-chunk.mjs"

[ -f "$F" ] || { echo "Version $V non installee : lancer ./run.sh $V d'abord."; exit 1; }

for S in repro-vue.mjs repro-effect.mjs; do cp "$S" "$D/$S"; done
echo "--- $V sans patch ---"
[ -f "$F.orig" ] && cp "$F.orig" "$F"
(cd "$D" && node repro-vue.mjs && node repro-effect.mjs)

echo "--- $V avec patch ---"
cp "$F" "$F.orig"
patch -N -s "$F" < angular-core-signal-dedup.patch
(cd "$D" && node repro-vue.mjs && node repro-effect.mjs)

# on remet l'installation dans son etat d'origine : sinon un ./run.sh ulterieur
# rejouerait une version PATCHEE en croyant tester la version publiee.
cp "$F.orig" "$F"
echo "($V restaure non patche)"
