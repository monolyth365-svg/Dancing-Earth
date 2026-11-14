#!/bin/sh
# Vydání na web: orazítkuje soubory novým číslem verze (aby prohlížeče nenačítaly starou verzi z mezipaměti),
# uloží změny a pošle je na GitHub (větev main = zdroj, větev gh-pages = veřejný web).
set -e
cd "$(dirname "$0")/.."
V=$(date +%s)
sed -i.bak -E "s/\\?v=[0-9]+/?v=$V/g" web/index.html && rm -f web/index.html.bak
git add -A
git commit -q -m "${1:-Update}" || true
git pull -q --rebase origin main
git push -q origin main
git subtree push --prefix web origin gh-pages 2>&1 | tail -1
echo "published v=$V"
