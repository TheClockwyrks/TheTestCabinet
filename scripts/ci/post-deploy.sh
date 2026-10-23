#!/usr/bin/env bash
# Settles the rest of a staging deployment once its backend is ready.
#
#   scripts/ci/post-deploy.sh <commit>
#
# The workspace template's scripts/ci/deploy.sh runs this hook once the rollout of
# `the-test-cabinet-backend` is ready, with the five THE_TEST_CABINET_* variables it
# resolved: the registry, the resource group, the cluster, the namespace and the
# rollout timeout. Two things are still unsettled then, and this settles both:
#
#   1. The same apply rolled every other Test Cabinet workload, which deploy.sh does
#      not wait on. scripts/ci/settle-workloads.sh waits on each, undoes each that
#      does not become ready, and fails when one did not.
#   2. The new backend pod's ingest sidecar is ingesting the catalog, which a backend
#      on a warm volume does not wait on to become ready.
#      scripts/ci/catalog-ingest.sh verify reads the result the sidecar recorded and
#      fails, printing the sidecar's failing step and message, unless it ingested.
#
# Both run whatever became of the other, so one failure does not hide the second,
# and the hook fails when either did. The backend stays rolled out either way, as
# deploy.sh says: the next deployment, or scripts/ci/deploy-environment.sh by hand,
# finishes the workloads, and `tcab ingest --env staging` the catalog.
set -euo pipefail

if [[ $# -ne 1 ]]; then
	echo "usage: scripts/ci/post-deploy.sh <commit>" >&2
	exit 1
fi

CI_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly CI_DIR
namespace="${THE_TEST_CABINET_NAMESPACE:-tcab-staging}"

settled=0
"${CI_DIR}/settle-workloads.sh" "$1" || settled=$?
ingested=0
"${CI_DIR}/catalog-ingest.sh" verify "${namespace#tcab-}" || ingested=$?

if [[ "$settled" -ne 0 ]]; then
	exit "$settled"
fi
exit "$ingested"
