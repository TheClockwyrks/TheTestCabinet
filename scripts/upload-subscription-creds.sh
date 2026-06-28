#!/usr/bin/env bash
# Upload the harness SUBSCRIPTION credentials (Codex + Claude Code) from this
# machine into Azure Key Vault, then refresh the cluster so new driver Jobs pick
# them up. Run it again whenever the tokens refresh — Claude Code's credentials are
# typically good for ~a day and Codex's for ~a week, so this is the routine you
# re-run, not a one-time setup.
#
# Background: subscription runs authenticate from per-harness sign-in files rather
# than an API key (see deployments/k8s/base/secrets.example.yaml and the dispatcher's
# TCAB_DISPATCHER_DRIVER_SUBSCRIPTION_* env). On the cluster those files live in the
# `tcab-driver-subscription` Secret, which the keyvault-csi component mirrors out of
# Key Vault. This script writes the local files into the matching Key Vault secrets
# and restarts the sync pod so that mirror is refreshed; the dispatcher then mounts
# the fresh files into each new driver Job.
#
# Key Vault secret names cannot contain dots/underscores, so the files map to dashed
# names that the SecretProviderClass maps back to the credential basenames the driver
# projects into the sandbox:
#   ~/.codex/auth.json             -> codex-auth-json         -> auth.json
#   ~/.claude.json                 -> claude-config-json      -> .claude.json
#   ~/.claude/.credentials.json    -> claude-credentials-json -> .credentials.json
#
# Claude Code needs BOTH .claude.json and .credentials.json. But ~/.claude.json
# accumulates a large server feature-flag cache and per-project history that push it
# past Key Vault's 25,600-char secret limit, so we upload a TRIMMED copy: the keys in
# CLAUDE_JSON_DROP_KEYS (caches + project history, none of which authenticate a run)
# are removed, keeping identity (userID, oauthAccount) and the rest. If the trimmed
# copy is still too large the script stops and lists the biggest remaining keys so you
# can extend the drop list.
#
# Values are never printed: each upload reads a file with `--file`, the trimmed copy
# is written to a private temp file and removed on exit, and the cluster refresh only
# restarts a pod. The script temporarily opens the vault firewall to this machine's
# egress IP only if it isn't already permitted, and removes that rule on exit (a
# no-op when you run it from the VPN, whose subnet is already allowed).
#
# Prerequisites: `az` logged in with rights to set secrets on the vault and run
# `az aks command invoke`; `jq`; the harness CLIs already signed in on this machine;
# and the keyvault-csi component already lists these objects (it does once
# deployments/k8s/overlays/azure-prod is applied).
#
# Usage:
#   scripts/upload-subscription-creds.sh
#
# Overridable via env (defaults shown):
#   VAULT=testcabinet-clockwyrks
#   RG=testcabinet-prod-westus2-rg
#   CLUSTER=testcabinet-prod-westus2-aks
#   NAMESPACE=tcab-prod
#   CODEX_AUTH=$HOME/.codex/auth.json
#   CLAUDE_CONFIG=$HOME/.claude.json
#   CLAUDE_CREDS=$HOME/.claude/.credentials.json
#   CLAUDE_JSON_DROP_KEYS=projects,cachedGrowthBookFeatures,cachedExperimentFeatures
set -euo pipefail

VAULT="${VAULT:-testcabinet-clockwyrks}"
RG="${RG:-testcabinet-prod-westus2-rg}"
CLUSTER="${CLUSTER:-testcabinet-prod-westus2-aks}"
NAMESPACE="${NAMESPACE:-tcab-prod}"
CODEX_AUTH="${CODEX_AUTH:-$HOME/.codex/auth.json}"
CLAUDE_CONFIG="${CLAUDE_CONFIG:-$HOME/.claude.json}"
CLAUDE_CREDS="${CLAUDE_CREDS:-$HOME/.claude/.credentials.json}"
# Large, auth-irrelevant keys stripped from ~/.claude.json before upload (caches +
# per-project history). Comma-separated; override to add more if the limit is hit.
CLAUDE_JSON_DROP_KEYS="${CLAUDE_JSON_DROP_KEYS:-projects,cachedGrowthBookFeatures,cachedExperimentFeatures}"

# Key Vault's hard ceiling is 25,600 chars; stay a little under it.
KV_SECRET_MAX=25000

command -v jq >/dev/null || { echo "jq is required but not installed." >&2; exit 1; }

# Fail early (and name the file) if a credential is missing, rather than uploading a
# partial set — most often it means the harness CLI isn't signed in on this machine.
missing=0
for f in "$CODEX_AUTH" "$CLAUDE_CONFIG" "$CLAUDE_CREDS"; do
  if [[ ! -s "$f" ]]; then
    echo "missing credential file: $f" >&2
    missing=1
  fi
done
if [[ "$missing" -ne 0 ]]; then
  echo "sign the harness CLIs in on this machine (codex / claude) and retry." >&2
  exit 1
fi

# Build the trimmed ~/.claude.json into a private temp file.
trimmed="$(mktemp)"
chmod 600 "$trimmed"
# Turn the comma list into a jq `del(.a, .b, …)` and apply it.
jq_del="del($(printf '.%s,' ${CLAUDE_JSON_DROP_KEYS//,/ } | sed 's/,$//'))"
jq -c "$jq_del" "$CLAUDE_CONFIG" > "$trimmed"

myip=""
added_rule=0
cleanup() {
  rm -f "$trimmed"
  if [[ "$added_rule" -eq 1 ]]; then
    echo "removing temporary vault firewall rule for ${myip}…"
    az keyvault network-rule remove --name "$VAULT" --ip-address "$myip" -o none 2>/dev/null || true
  fi
}
trap cleanup EXIT

# Guard the 25,600-char limit before touching the vault, and point at the offenders.
chars="$(wc -c < "$trimmed")"
if (( chars > KV_SECRET_MAX )); then
  echo "trimmed ~/.claude.json is still ${chars} chars (limit ${KV_SECRET_MAX})." >&2
  echo "biggest remaining keys (name<TAB>bytes) — add some to CLAUDE_JSON_DROP_KEYS:" >&2
  jq -r 'to_entries | map({k:.key, b:(.value|tostring|length)}) | sort_by(-.b) | .[:8][] | "  \(.k)\t\(.b)"' "$trimmed" >&2
  exit 1
fi
echo "trimmed ~/.claude.json -> ${chars} chars (dropped: ${CLAUDE_JSON_DROP_KEYS})"

# Open the vault firewall to this machine only if it isn't already allowed (cleanup
# undoes it). Comparing the bare IP matches whether the rule is stored as a /32.
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
  sleep 20 # let the network ACL propagate before the data-plane writes
fi

echo "uploading subscription credentials to Key Vault ${VAULT}…"
az keyvault secret set --vault-name "$VAULT" --name codex-auth-json        --file "$CODEX_AUTH" -o none
echo "  set codex-auth-json          (from ${CODEX_AUTH})"
az keyvault secret set --vault-name "$VAULT" --name claude-credentials-json --file "$CLAUDE_CREDS" -o none
echo "  set claude-credentials-json  (from ${CLAUDE_CREDS})"
az keyvault secret set --vault-name "$VAULT" --name claude-config-json      --file "$trimmed" -o none
echo "  set claude-config-json       (trimmed from ${CLAUDE_CONFIG})"

echo "refreshing the cluster secret sync (rollout restart tcab-keyvault-sync)…"
az aks command invoke -g "$RG" -n "$CLUSTER" \
  --command "kubectl rollout restart deploy/tcab-keyvault-sync -n ${NAMESPACE} && kubectl rollout status deploy/tcab-keyvault-sync -n ${NAMESPACE} --timeout=90s" \
  >/dev/null

echo "done — new driver Jobs will mount the refreshed subscription credentials."
