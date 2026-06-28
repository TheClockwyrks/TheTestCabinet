#!/bin/sh
# Render the console's runtime config into the web root before nginx starts.
#
# The base nginx-unprivileged image runs every executable script under
# /docker-entrypoint.d/ (in name order) before launching nginx, so this lands as
# 30-… after the base image's own 10-/20- setup scripts. It envsubst's ONLY the
# two TCAB_WEB_* variables into /config.js, overwriting the placeholder shipped in
# the bundle. Defaulting both to empty means an unset env still produces a valid
# (empty) config rather than leaving literal ${...} placeholders or failing.
set -eu

: "${TCAB_WEB_BACKEND_URL:=}"
: "${TCAB_WEB_AUTH_URL:=}"
export TCAB_WEB_BACKEND_URL TCAB_WEB_AUTH_URL

template=/etc/nginx/templates/config.js.template
output=/usr/share/nginx/html/config.js

# Restrict substitution to our own variables so any other ${...} in the template
# (there is none today, but keep it hermetic) is left untouched.
envsubst '${TCAB_WEB_BACKEND_URL} ${TCAB_WEB_AUTH_URL}' < "$template" > "$output"

echo "tcab-web: rendered $output (backend='${TCAB_WEB_BACKEND_URL}' auth='${TCAB_WEB_AUTH_URL}')"
