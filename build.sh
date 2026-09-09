#!/bin/sh
# Rebuild the minified assets the pages serve.
#
# Run this before a release, then commit the .min files it writes:
#
#     ./build.sh
#
# While a page is still being designed it may load its sources directly (see
# the note under PORTAL below) — this script still refreshes its .min files, so
# switching that page over is only ever a matter of editing its <link>/<script>
# tags.
#
# Needs node + network on the first run of each tool (npx fetches them).
set -e
cd "$(dirname "$0")"

CACHE="${TMPDIR:-/tmp}/nelyce-npm-cache"
minify_js()  { npm_config_cache="$CACHE" npx --yes terser "$1" -c -m -o "$2"; }
minify_css() { npm_config_cache="$CACHE" npx --yes clean-css-cli -o "$2" "$1"; }

size() { awk -v b="$(wc -c < "$1")" 'BEGIN { printf "%.1f", b / 1024 }'; }
report() { printf '  %-28s %6s KB -> %6s KB\n' "$1" "$(size "$1")" "$(size "$2")"; }

echo "JavaScript"
for f in js/script.js js/currency.js js/customize.js js/customize-data.js \
         js/social-calculator.js js/social-calculator-data.js js/faq.js \
         js/portal.js js/portal-data.js js/prices.js js/site-prices.js js/admin.js; do
    [ -f "$f" ] || continue
    out="${f%.js}.min.js"
    node --check "$f"          # never minify something that does not parse
    minify_js "$f" "$out"
    report "$f" "$out"
done

echo "CSS"
for f in css/style.css css/faq.css css/social-calculator.css css/portal.css css/admin.css; do
    [ -f "$f" ] || continue
    out="${f%.css}.min.css"
    minify_css "$f" "$out"
    report "$f" "$out"
done

echo
echo "Done. Commit the .min files, and check that each page's <link> and"
echo "<script> tags point at the .min build before releasing."
