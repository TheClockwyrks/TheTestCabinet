#!/usr/bin/env bash
# Installs `wrangler`, the Cloudflare CLI that `tcab publish` shells out to in
# order to deploy each run's playable build to Cloudflare Pages
# (`wrangler pages deploy ... --branch=<run-id>`).
#
# Installed globally with npm, so this must run AFTER the Node install script.
# Authenticate separately with `wrangler login` or a CLOUDFLARE_API_TOKEN (plus
# CLOUDFLARE_ACCOUNT_ID) in the environment; the credentials are never baked in.
set -euo pipefail

npm install -g wrangler

echo "Installed wrangler $(wrangler --version)"
