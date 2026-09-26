#!/usr/bin/env bash
# Builds the documentation site and deploys it to Cloudflare Pages.
#
#   scripts/ci/deploy-docs.sh <branch>
#
# `master` deploys to the `test-cabinet-docs` project (docs.testcabinet.ai) and
# `staging` to `test-cabinet-docs-staging`. The branch is passed to wrangler as
# `--branch`, which makes the upload that project's production deployment because
# each project's production branch is the branch it deploys from.
#
# CLOUDFLARE_API_TOKEN (Cloudflare Pages: Edit) and CLOUDFLARE_ACCOUNT_ID must be in
# the environment. The pipeline maps them from its secret variables of the same names.
set -euo pipefail
# shellcheck source=/dev/null
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

# The wrangler release the publisher image pins (WRANGLER_VERSION in
# deployments/images/services.Dockerfile).
readonly WRANGLER_VERSION="4.40.3"

if [[ $# -ne 1 ]]; then
	echo "usage: scripts/ci/deploy-docs.sh <branch>" >&2
	exit 1
fi
readonly BRANCH="$1"

case "$BRANCH" in
	master) project=test-cabinet-docs ;;
	staging) project=test-cabinet-docs-staging ;;
	*)
		echo "deploy-docs.sh: '${BRANCH}' deploys no docs (expected master or staging)" >&2
		exit 1
		;;
esac

: "${CLOUDFLARE_API_TOKEN:?CLOUDFLARE_API_TOKEN must be set}"
: "${CLOUDFLARE_ACCOUNT_ID:?CLOUDFLARE_ACCOUNT_ID must be set}"

log "npm ci"
npm ci

log "build @clockwyrks/docs"
npm run build -w @clockwyrks/docs

log "deploy to ${project}"
npx --yes "wrangler@${WRANGLER_VERSION}" pages deploy apps/docs/dist \
	--project-name="$project" --branch="$BRANCH"
