#!/usr/bin/env bash
# Settles the rest of a staging deployment once its backend is ready.
#
#   scripts/ci/post-deploy.sh <commit>
#
# The workspace template's scripts/ci/deploy.sh runs this hook once the rollout of
# `the-test-cabinet-backend` is ready, with the five THE_TEST_CABINET_* variables it
# resolved: the registry, the resource group, the cluster, the namespace and the
# rollout timeout. The same apply rolled every other Test Cabinet workload, which
# deploy.sh does not wait on, so this hands them to scripts/ci/settle-workloads.sh:
# it waits on each, undoes each that does not become ready, and fails when one did
# not. The backend stays rolled out either way, as deploy.sh says; the next
# deployment, or scripts/ci/deploy-environment.sh by hand, finishes the work.
set -euo pipefail

if [[ $# -ne 1 ]]; then
	echo "usage: scripts/ci/post-deploy.sh <commit>" >&2
	exit 1
fi

exec "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/settle-workloads.sh" "$1"
