#!/usr/bin/env bash
# Checks what a staging deployment cannot roll back from, before it applies anything.
#
#   scripts/ci/deploy-preflight.sh <commit>
#
# The workspace template's scripts/ci/deploy.sh runs this hook before its apply, with
# the five THE_TEST_CABINET_* variables it resolved, and applies nothing when it
# fails. The new backend pod's ingest sidecar fetches the catalog branch tip and the
# cold-storage commit it pins as it starts, and ingests nothing when it cannot, so
# this hands the check that both are fetchable to scripts/ci/catalog-ingest.sh
# preflight. scripts/ci/pre-deploy.sh makes the same check first in the pipeline,
# before it retires anything; this one covers a roll by hand with deploy.sh alone.
set -euo pipefail

if [[ $# -ne 1 ]]; then
	echo "usage: scripts/ci/deploy-preflight.sh <commit>" >&2
	exit 1
fi

namespace="${THE_TEST_CABINET_NAMESPACE:-tcab-staging}"
exec "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/catalog-ingest.sh" preflight "${namespace#tcab-}" "$1"
