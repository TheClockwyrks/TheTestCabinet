#!/usr/bin/env bash
# Publish catalog changes (test cases and game jams) to a REMOTE (prod/staging) backend
# on AKS, on demand.
#
# The in-pod ingest sidecar ingests only once, on backend start, so each deployment
# serves the catalog of its branch tip. It does NOT re-ingest on a schedule: a periodic force re-ingest rewrites every version and briefly leaves
# each one manifest-less, which 404s ("… is not ingested") any run that resolves its
# version mid-cycle. So after you push edits to a test-case version, run this to
# refresh the backend's checkout and force a re-ingest. The backend swaps each version
# into place atomically, so this is safe to run while runs are executing.
#
# This same re-ingest also reconciles reference-implementation build URLs: the
# backend reads the committed test-cases/reference-builds.lock.json, takes the
# entries for its own TCAB_ENV, and makes its case_reference_build table match them
# (upsert + prune). So after `tcab publish-reference` deploys a reference and you
# commit + push the lockfile, this is the command that lands it on the site's
# Reference tab — the pull half of the reference-publish flow.
#
# It drives the cluster with `az aks command invoke`, so it needs only an
# authenticated `az` and `jq` (no local kubeconfig or port-forward). It exits non-zero
# unless the ingest succeeded: when the cluster-side command failed, when it was still
# running once the wait on it ran out, and when it could not be handed to the cluster.
# The invoked command execs
# into the backend pod's `ingest` sidecar — which already carries git + curl and
# mounts the /state/checkout the backend ingests from — to `git fetch` the latest
# pushed HEAD, update its cold-storage submodule (the baseline validation media ingest
# copies into the store) to the pinned commit shallowly, and POST a forced ingest over
# localhost (the NetworkPolicy admits only
# intra-pod traffic to the backend).
#
# Like the sidecar, it ingests only from a checkout it brought to the branch tip with
# its cold storage at the pinned commit: a fetch that fails, or cold storage that is
# not at its pin afterwards, stops it before the POST, so the store and its baselines
# stay as they were, and it prints the free space on /state, which a fetch that cannot
# write is usually short of. A whole-catalog run is therefore also how an environment
# that lost its baselines gets them back.
#
# A whole-catalog run that succeeds also records itself as the pod's ingest result,
# the file scripts/ci/catalog-ingest.sh verify reads. A deployment that failed because
# its sidecar could not ingest therefore passes its verify once this has repaired it,
# on a re-run of the deployment's stage with no new pod.
#
# A case's identity is the `slug` its test-case.toml declares (NOT its folder name; the
# two usually match but can differ — carom/ pins slug = "pong"). Game jams are authored
# in the sibling `game-jams/<slug>/<version>/` tree with a `game-jam.toml` instead, and
# the backend's discovery folds them into this same catalog — so they need no separate
# command here: a whole-catalog re-ingest covers them, and a jam is targetable by slug
# exactly like a case (`scripts/reingest-cluster.sh --env staging well-well-well`).
# Note this script does NOT scan the working tree the way scripts/reingest.sh does — it
# only forwards slugs to the backend, which enumerates both trees itself, so there is no
# per-tree change detection to keep in sync here. A WHOLE-CATALOG
# re-ingest (no slug args) also PRUNES the store: any (slug, version) the checkout no
# longer declares is dropped, EXCEPT one a published/pending run still references (kept
# so the run stays resolvable and keeps its case metadata in the snapshot). So a folder
# rename that keeps its slug, or a deleted run-less case, self-heals on the next full
# re-ingest here — no pod restart / rebuild-from-empty needed. A scan scoped to slug
# args never prunes (it hasn't seen the whole catalog); target by slug or folder name.
#
# Usage (the target environment is REQUIRED):
#   scripts/reingest-cluster.sh --env prod                # force re-ingest every case
#   scripts/reingest-cluster.sh --env staging carom       # scope to one case slug
#   scripts/reingest-cluster.sh --env prod carom coil     # scope to several
#   scripts/reingest-cluster.sh --env staging well-well-well  # a game jam, same as a case
#
# The cluster, namespace, and the catalog branch the backend ingests from all come
# from scripts/lib/env.sh for the chosen env (staging → `staging`, prod → `master`).
# The branch tip is fetched, so a re-ingest picks up whatever catalog + reference-build
# lockfile changes have been pushed — that on-demand refresh is what this script is for.
# The service CODE version is the commit the pipeline last deployed (scripts/ci/deploy.sh
# for staging, scripts/ci/deploy-environment.sh for prod).
set -euo pipefail

# Resolve the target environment from a REQUIRED --env <prod|staging> (scripts/lib/env.sh);
# any remaining args are case slugs. No default, so a re-ingest can never silently hit prod.
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
env=""
slugs=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --env) env="${2:-}"; shift 2 ;;
    --env=*) env="${1#*=}"; shift ;;
    *) slugs+=("$1"); shift ;;
  esac
done
# shellcheck source=scripts/lib/env.sh
source "${script_dir}/lib/env.sh"
tcab_env_resolve "$env" || exit $?
if (( ${#slugs[@]} )); then set -- "${slugs[@]}"; else set --; fi
resource_group="$TCAB_RG"
cluster="$TCAB_CLUSTER"
namespace="$TCAB_NAMESPACE"

# Build the ingest request body. With no slugs, scan everything; otherwise restrict
# the scan to the given slugs. Always force, so an unchanged version string (the store
# is immutable per version) is overwritten with the freshly pushed definition.
if [[ $# -eq 0 ]]; then
  body='{"force": true}'
  scope="every case"
else
  cases=""
  for slug in "$@"; do
    cases+="\"${slug}\","
  done
  body="{\"testCases\": [${cases%,}], \"force\": true}"
  scope="$*"
fi

echo "Re-ingesting ${scope} on ${cluster}/${namespace} (force)…"

for tool in az jq; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "reingest-cluster.sh: no ${tool} on PATH. az hands the command to the cluster and jq reads its verdict." >&2
    exit 1
  fi
done

# lib.sh's aks_invoke runs the script below in the cluster and answers with the
# script's own exit code, which `az aks command invoke` alone does not carry, and it
# reads a command az stopped waiting on back until it ends. Sourcing lib.sh puts
# this shell in the repository root.
# shellcheck source=scripts/ci/lib.sh
source "${script_dir}/ci/lib.sh"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
remote="${work}/reingest-cluster-remote.sh"

# The script that runs cluster-side, in an `az aks command invoke` helper pod. Its
# settings are written at its head; the rest is quoted, so it reaches the cluster as
# written here. It execs the backend's `ingest` sidecar to refresh the checkout to the
# catalog branch tip, then triggers the ingest. The branch, the JSON body and the
# scope are positional arguments of the innermost `sh`, so their contents never
# collide with the surrounding shells. `--fail-with-body` keeps a render error's
# message (and a non-2xx exit) from vanishing. `origin` is the remote the sidecar's
# clone set up.
#
# After a whole-catalog ingest the sidecar's result file is rewritten as `ok`. That
# file is what scripts/ci/catalog-ingest.sh verify reads, and the sidecar writes it
# once per pod start, so a deployment whose sidecar failed would otherwise read as
# failed for as long as its pod lives, however well this repair went. A scoped
# ingest leaves the file alone: it has not ingested the catalog.
{
  printf 'NAMESPACE=%q\nBRANCH=%q\nBODY=%q\nWHOLE=%q\n' \
    "$namespace" "$TCAB_INGEST_BRANCH" "$body" "$([[ $# -eq 0 ]] && echo yes || echo no)"
  cat <<'REMOTE'
set -u
k() { kubectl -n "$NAMESPACE" "$@"; }

# shellcheck disable=SC2016 # the sidecar's shell expands these, not this one
if k exec deploy/the-test-cabinet-backend -c ingest -- sh -c 'set -e
state="${TCAB_INGEST_STATE:-/state}"
checkout="$state/checkout"
echo "ingest: refreshing $checkout to origin/$1"
git -C "$checkout" fetch --depth 1 origin "$1"
git -C "$checkout" reset --hard FETCH_HEAD
echo "ingest: updating the cold-storage submodule"
git -C "$checkout" submodule sync
git -C "$checkout" submodule update --init --depth 1
pinned=$(git -C "$checkout" rev-parse --verify HEAD:cold-storage)
actual=$(git -C "$checkout/cold-storage" rev-parse --verify HEAD)
if [ "$actual" != "$pinned" ]; then
  echo "ingest: cold storage is at $actual and the checkout pins $pinned; not ingesting"
  exit 1
fi
echo "ingest: triggering forced re-ingest"
curl -sS --fail-with-body -X POST "${TCAB_INGEST_BACKEND_URL:-http://127.0.0.1:8787}/ingest" -H "content-type: application/json" --data "$2"
echo
if [ "$3" = yes ]; then
  result="${TCAB_INGEST_RESULT:-/tmp/ingest-result}"
  commit=$(git -C "$checkout" rev-parse --verify HEAD)
  printf "status=ok\nstep=ingest\nbranch=%s\ncommit=%s\n\nThe backend ingested %s at %s, by scripts/reingest-cluster.sh.\n" "$1" "$commit" "$1" "$commit" >"$result.tmp"
  mv "$result.tmp" "$result"
  echo "ingest: recorded the ingest of $commit as this pod'"'"'s result"
fi' sh "$BRANCH" "$BODY" "$WHOLE"; then
  echo "REINGEST ok"
  exit 0
fi
echo "REINGEST failed, above. Nothing further was ingested. Free space on /state:"
k exec deploy/the-test-cabinet-backend -c ingest -- df -hP /state || true
exit 1
REMOTE
} >"$remote"

verdict=0
aks_invoke "$resource_group" "$cluster" "$remote" "bash $(basename "$remote")" || verdict=$?
case "$verdict" in
  0)
    echo "Done. If a reference failed to render, the message is in the output above."
    ;;
  1)
    echo >&2 "reingest-cluster.sh: the re-ingest of ${scope} on ${cluster}/${namespace} FAILED, above."
    remediation \
      "The store, its baselines and the public snapshot are as the last ingest that" \
      "succeeded left them. Fix what the output names, then run this again."
    exit 1
    ;;
  3)
    echo >&2 "reingest-cluster.sh: the re-ingest was still running when the wait ran out, above."
    remediation \
      "It runs on in the cluster and nothing was undone. Read its end with the command" \
      "above; it ends in 'REINGEST ok' or 'REINGEST failed'."
    exit 1
    ;;
  *)
    echo >&2 "reingest-cluster.sh: the command could not be handed to ${cluster}, above."
    remediation "Nothing was ingested. Sign in with az and run this again."
    exit 1
    ;;
esac
