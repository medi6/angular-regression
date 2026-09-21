#!/usr/bin/env bash
# Execute repro.mjs contre plusieurs versions d'Angular, chacune installee
# dans son propre dossier sous versions/.
set -u
cd "$(dirname "$0")"

VERSIONS="${*:-21.2.5 22.0.0 22.0.1 22.0.2 22.1.7}"

for V in $VERSIONS; do
  D="versions/$V"
  if [ ! -d "$D/node_modules/@angular/core" ]; then
    mkdir -p "$D"
    printf '{"name":"repro-%s","private":true,"type":"module"}\n' "$V" > "$D/package.json"
    (cd "$D" && npm install --silent --no-audit --no-fund "@angular/core@$V" rxjs zone.js >/dev/null 2>&1)
  fi
  if [ ! -d "$D/node_modules/@angular/core" ]; then
    echo "{\"version\":\"$V\",\"erreur\":\"installation impossible\"}"
    continue
  fi
  for S in repro-vue.mjs repro-effect.mjs controle-ordre-lecture.mjs; do
    cp "$S" "$D/$S"
  done
  echo "=== Angular $V ==="
  (cd "$D" && node repro-vue.mjs && node repro-effect.mjs && node controle-ordre-lecture.mjs)
done
