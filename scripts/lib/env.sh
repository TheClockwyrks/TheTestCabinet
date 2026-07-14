#!/usr/bin/env bash
# Shared per-environment target resolver for the REMOTE cluster/vault scripts.
#
# The scripts that act on a deployed environment — upload-subscription-creds.sh,
# enable-secret-rotation.sh, reingest-cluster.sh, backfill-run-media.sh — take a
# REQUIRED `--env <prod|staging>` and source this file to turn that name into the
# concrete Azure resources they operate on. Keeping the mapping here means the
# per-environment facts (Key Vault, AKS cluster, resource group, namespace) live in
# exactly ONE place: adding an environment, or moving a resource, is a one-line edit
# here instead of a sweep across every script.
#
# There is deliberately NO default. A caller must always name the target, so a
# cluster/vault operation can never silently fall through to prod — that missing
# guard (the old `${VAULT:-testcabinet-clockwyrks}` / `${CLUSTER:-…-prod-…}` defaults)
# was the footgun this convention removes.
#
# NOTE: scripts/reingest.sh is intentionally NOT one of these — it targets a plain
# BACKEND_URL (a local, or port-forwarded, backend) over HTTP, not a cluster, so it
# keeps its safe localhost default and takes no --env. Use reingest-cluster.sh for a
# deployed environment.
#
# Usage (from a script that has computed its own $script_dir):
#   source "${script_dir}/lib/env.sh"
#   tcab_env_resolve "$env"   # sets TCAB_VAULT / TCAB_CLUSTER / TCAB_RG / TCAB_NAMESPACE
#
# Returns 2 (and prints a usage error) for an empty or unknown env, so callers can:
#   tcab_env_resolve "$env" || exit $?

# The TCAB_* vars below are consumed by the sourcing script, not here, so ShellCheck
# cannot see their use across the source boundary — silence the false "unused" warning.
# shellcheck disable=SC2034
tcab_env_resolve() {
  case "${1:-}" in
    prod)
      TCAB_VAULT="testcabinet-clockwyrks"
      TCAB_CLUSTER="testcabinet-prod-westus2-aks"
      TCAB_RG="testcabinet-prod-westus2-rg"
      TCAB_NAMESPACE="tcab-prod"
      # The branch whose tip the backend ingests its catalog (test-case defs + the
      # reference-build lockfile) from. A stable branch — NOT a per-release tag — so
      # reingest picks up pushed catalog/reference changes on demand without a roll;
      # the service CODE version is pinned separately by the overlay's image newTag.
      # Kept == the branch each overlay's patch-backend-ingest.yaml clones.
      TCAB_INGEST_BRANCH="master"
      # The artifact service's PUBLIC (internal-ingress) read URL for this env.
      TCAB_ARTIFACTS_PUBLIC_URL="https://artifacts.tcab.testcabinet.ai"
      ;;
    staging)
      TCAB_VAULT="testcabinet-staging"
      TCAB_CLUSTER="testcabinet-staging-westus2-aks"
      TCAB_RG="testcabinet-staging-westus2-rg"
      TCAB_NAMESPACE="tcab-staging"
      TCAB_INGEST_BRANCH="staging"
      TCAB_ARTIFACTS_PUBLIC_URL="https://artifacts.staging.tcab.testcabinet.ai"
      ;;
    "")
      echo "error: --env is required (one of: prod, staging)" >&2
      return 2
      ;;
    *)
      echo "error: unknown --env '${1}' (expected: prod, staging)" >&2
      return 2
      ;;
  esac
}
