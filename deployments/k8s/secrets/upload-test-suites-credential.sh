#!/usr/bin/env bash
# Upload the READ-ONLY test suites credential into an environment's Azure Key Vault,
# from which the keyvault-csi component materializes the `tcab-test-suites-credential`
# Kubernetes Secret (key `token`) the backend pod's ingest sidecar mounts.
#
# The superproject's .gitmodules names the test suites repository by its Azure DevOps
# SSH URL. The sidecar rewrites that URL to the repository's HTTPS address and answers
# git's credential request with this token, so a deployed checkout clones and refreshes
# the submodule at the commit its branch names. Azure DevOps SSH keys carry the full
# rights of the user who added them, so the credential is a personal access token
# scoped to Code (Read) on the test suites repository instead.
#
# Run it once per environment before applying its azure-* overlay (the CSI mount fails
# while any listed vault object is absent), and again whenever the token is rotated;
# secret auto-rotation reconciles the new value into the Secret within ~2m, and the
# sidecar reads the mounted file on every fetch.
#
# The token is read from TCAB_TEST_SUITES_TOKEN when it is set, and otherwise prompted
# for without echo. It is never printed: it is written to a private temp file for
# `az keyvault secret set --file` and removed on exit. The vault firewall is opened to
# this machine's egress IP only when it is not already allowed, and closed again on exit.
#
# Usage (the target environment is REQUIRED):
#   deployments/k8s/secrets/upload-test-suites-credential.sh --env staging
#   TCAB_TEST_SUITES_TOKEN=… deployments/k8s/secrets/upload-test-suites-credential.sh --env prod
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${script_dir}/../../.." && pwd)"
env=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --env) env="${2:-}"; shift 2 ;;
    --env=*) env="${1#*=}"; shift ;;
    *) echo "unknown argument: $1 (usage: $0 --env <prod|staging>)" >&2; exit 2 ;;
  esac
done
# shellcheck source=scripts/lib/env.sh
source "${repo_root}/scripts/lib/env.sh"
tcab_env_resolve "$env" || exit $?
VAULT="$TCAB_VAULT"
SECRET_NAME="test-suites-read-token"

token="${TCAB_TEST_SUITES_TOKEN:-}"
if [[ -z "$token" ]]; then
  if [[ ! -t 0 ]]; then
    echo "set TCAB_TEST_SUITES_TOKEN, or run this from a terminal to be prompted." >&2
    exit 2
  fi
  read -rsp "Read-only test suites token for ${env} (Azure DevOps PAT, Code: Read): " token
  echo
fi
if [[ -z "$token" ]]; then
  echo "no token given." >&2
  exit 2
fi

token_file="$(mktemp)"
chmod 600 "$token_file"
printf '%s' "$token" > "$token_file"
unset token

myip=""
added_rule=0
cleanup() {
  rm -f "$token_file"
  if [[ "$added_rule" -eq 1 ]]; then
    echo "removing temporary vault firewall rule for ${myip}…"
    az keyvault network-rule remove --name "$VAULT" --ip-address "$myip" -o none 2>/dev/null || true
  fi
}
trap cleanup EXIT

myip="$(curl -fsS https://ifconfig.me 2>/dev/null || curl -fsS https://api.ipify.org)"
if [[ -z "$myip" ]]; then
  echo "could not determine this machine's egress IP." >&2
  exit 1
fi
existing="$(az keyvault network-rule list --name "$VAULT" --query 'ipRules[].value' -o tsv 2>/dev/null || true)"
if ! grep -qF "$myip" <<<"$existing"; then
  echo "temporarily allowing ${myip} on the ${VAULT} firewall…"
  az keyvault network-rule add --name "$VAULT" --ip-address "$myip" -o none
  added_rule=1
  sleep 20 # let the network ACL propagate before the data-plane write
fi

echo "uploading the read-only test suites credential to Key Vault ${VAULT}…"
az keyvault secret set --vault-name "$VAULT" --name "$SECRET_NAME" --file "$token_file" -o none
echo "  set ${SECRET_NAME}"
echo "done — the CSI driver reconciles it into the tcab-test-suites-credential Secret"
echo "within the rotation poll interval (~2m)."
