#!/usr/bin/env bash
# Brings the Secrets the Key Vault CSI driver syncs to the keys the render about to
# be applied declares, before the apply rolls any workload that reads them.
#
#   scripts/ci/sync-secrets.sh [--dry-run] <rendered-manifest>
#
# The keyvault-csi component's SecretProviderClass (`tcab-keyvault`) fans the vault
# into the Secrets the workloads read, and the always-on `tcab-keyvault-sync`
# Deployment keeps them synced by mounting it. The driver creates a Secret it lacks
# when a pod mounts the class, and auto-rotation refreshes the values of one it has,
# but it never adds a key to a synced Secret or removes one from it. So a render that
# declares a new Secret, or changes the keys of one, needs that Secret deleted and the
# mounter restarted before a workload reading it rolls: the artifacts service refuses
# to start without the public store its `tcab-artifacts-secrets` carries, and a
# workload that `envFrom`s a Secret keeps a key the class no longer declares (the
# backend's former `TCAB_R2_*`, the publisher's former `GH_TOKEN`) until it is gone.
#
# This sends one command into the cluster, which:
#
#   1. applies every SecretProviderClass the render holds, so the restart below
#      mounts the class this deploy declares;
#   2. reads the keys of each Secret the classes declare, and deletes each whose keys
#      differ from the declared ones;
#   3. when a Secret was absent or deleted, restarts `tcab-keyvault-sync`, waits for
#      its rollout, then waits until every such Secret holds the declared keys.
#
# It is idempotent: when every Secret already holds the declared keys, it applies the
# class and changes nothing else. A render without a SecretProviderClass (the local
# overlay) sends nothing. A namespace without `tcab-keyvault-sync` yet is left to the
# apply, which creates the mounter, whose start syncs the Secrets.
#
# The cluster's API server is private, so the command runs inside the cluster through
# `az aks command invoke` (lib.sh's aks_invoke), under the caller's Azure identity.
# Three variables name where, each defaulting to the staging deployment:
#
#   THE_TEST_CABINET_RESOURCE_GROUP  The resource group the cluster sits in
#   THE_TEST_CABINET_CLUSTER         The cluster's name
#   THE_TEST_CABINET_NAMESPACE       The namespace the Secrets are synced in
#
# `--dry-run` prints the command it would send, and sends nothing.
#
# Called by scripts/ci/pre-deploy.sh (the staging deployment) and
# scripts/ci/deploy-environment.sh (prod, and any deployment by hand), after the
# legacy objects are retired and before the apply.
set -euo pipefail

# shellcheck source=scripts/ci/lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

readonly RESOURCE_GROUP="${THE_TEST_CABINET_RESOURCE_GROUP:-testcabinet-staging-westus2-rg}"
readonly CLUSTER="${THE_TEST_CABINET_CLUSTER:-testcabinet-staging-westus2-aks}"
readonly NAMESPACE="${THE_TEST_CABINET_NAMESPACE:-tcab-staging}"
readonly MOUNTER="tcab-keyvault-sync"
readonly USAGE="usage: scripts/ci/sync-secrets.sh [--dry-run] <rendered-manifest>"
# How long the command waits for the restarted mounter, then for the Secrets: well
# inside the ten minutes AKS gives a command.
readonly ROLLOUT_TIMEOUT="300s"
readonly SYNC_POLLS=48
readonly SYNC_POLL_SECONDS=5

dry_run=""
if [[ "${1:-}" == --dry-run ]]; then
	dry_run=1
	shift
fi
if [[ $# -ne 1 || ! -f "$1" ]]; then
	echo "$USAGE" >&2
	exit 1
fi
readonly MANIFEST="$1"

# The SecretProviderClass documents of the render, as they are.
classes() {
	awk '
		function flush() { if (doc ~ /(^|\n)kind: SecretProviderClass\n/) printf "---\n%s", doc; doc = "" }
		/^---/ { flush(); next }
		{ doc = doc $0 "\n" }
		END { flush() }
	' "$MANIFEST"
}

# One line per Secret the classes declare: its name, then its keys, each followed by
# a space, in byte order, which is how the go-template the cluster runs lists them.
declared_secrets() {
	classes | awk '
		function unquote(v) { gsub(/^["\047]|["\047]$/, "", v); return v }
		function flush() {
			if (secret != "") for (i = 1; i <= n; i++) print secret, keys[i]
			secret = ""; n = 0
		}
		/^---/ { flush(); within = 0; next }
		/^  secretObjects:/ { within = 1; next }
		within && /^  [^ -]/ { flush(); within = 0 }
		within && /^[^ ]/ { flush(); within = 0 }
		!within { next }
		/^  - / { flush() }
		/^ *(- )?secretName: / { sub(/^ *(- )?secretName: /, ""); secret = unquote($0) }
		/^ *(- )?key: / { sub(/^ *(- )?key: /, ""); keys[++n] = unquote($0) }
		END { flush() }
	' | LC_ALL=C sort -u | awk '
		$1 != name { if (name != "") print name " " line; name = $1; line = "" }
		{ line = line $2 " " }
		END { if (name != "") print name " " line }
	'
}

class_documents="$(classes)"
if [[ -z "$class_documents" ]]; then
	echo "The render declares no SecretProviderClass; no synced Secret to check."
	exit 0
fi
secrets="$(declared_secrets)"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
readonly SCRIPT="${work}/sync-secrets.sh"
# The sent script is plain sh, and the single-quoted $ are its own expansions.
# shellcheck disable=SC2016
{
	echo "set -eu"
	echo "ns=${NAMESPACE}"
	echo "kubectl -n \"\$ns\" apply -f - <<'TCAB_SECRET_PROVIDER_CLASS'"
	printf '%s\n' "$class_documents"
	echo "TCAB_SECRET_PROVIDER_CLASS"
	cat <<'SCRIPT'
keys() { kubectl -n "$ns" get secret "$1" --ignore-not-found -o go-template='{{range $k, $v := .data}}{{$k}} {{end}}'; }
exists() { [ -n "$(kubectl -n "$ns" get secret "$1" --ignore-not-found -o name)" ]; }
stale=""
check() { # secret declared-keys
	if ! exists "$1"; then
		echo "The Secret $1 is not synced yet."
		stale="$stale $1"
		return 0
	fi
	have="$(keys "$1")"
	if [ "$have" != "$2" ]; then
		echo "The Secret $1 holds the keys [$have]; the class declares [$2]. Deleting it so it syncs again."
		kubectl -n "$ns" delete secret "$1" --wait=true
		stale="$stale $1"
	fi
}
SCRIPT
	echo 'want() { # secret: the keys the class declares for it'
	echo '	case "$1" in'
	while read -r name keys; do
		printf "\t\t%s) echo '%s ' ;;\n" "$name" "$keys"
	done <<<"$secrets"
	echo '	esac'
	echo '}'
	while read -r name _; do
		printf 'check %s "$(want %s)"\n' "$name" "$name"
	done <<<"$secrets"
	cat <<SCRIPT
if [ -z "\$stale" ]; then
	echo "Every synced Secret holds the keys the class declares."
	exit 0
fi
if [ -z "\$(kubectl -n "\$ns" get deployment ${MOUNTER} --ignore-not-found -o name)" ]; then
	echo "No ${MOUNTER} in \$ns yet; the apply creates it, and its start syncs\$stale."
	exit 0
fi
kubectl -n "\$ns" rollout restart deployment/${MOUNTER}
kubectl -n "\$ns" rollout status deployment/${MOUNTER} --timeout=${ROLLOUT_TIMEOUT}
polls=0
while :; do
	missing=""
	for secret in \$stale; do
		[ "\$(keys "\$secret")" = "\$(want "\$secret")" ] || missing="\$missing \$secret"
	done
	[ -z "\$missing" ] && break
	if [ "\$polls" -ge ${SYNC_POLLS} ]; then
		echo "${MOUNTER} restarted, but\$missing did not sync with the declared keys within $((SYNC_POLLS * SYNC_POLL_SECONDS)) seconds." >&2
		kubectl -n "\$ns" describe deployment/${MOUNTER} >&2 || true
		exit 1
	fi
	polls=\$((polls + 1))
	sleep ${SYNC_POLL_SECONDS}
done
echo "Synced\$stale with the keys the class declares."
SCRIPT
} >"$SCRIPT"
if [[ -n "$dry_run" ]]; then
	echo "Would run on ${CLUSTER} (${RESOURCE_GROUP}):"
	sed 's/^/    /' "$SCRIPT"
	exit 0
fi

for tool in az jq; do
	if ! command -v "$tool" >/dev/null 2>&1; then
		echo "sync-secrets.sh: no ${tool} on PATH. az hands the command to the cluster and jq reads its verdict." >&2
		exit 1
	fi
done

echo "Syncing the Secrets the render declares in ${NAMESPACE} on ${CLUSTER}: $(cut -d' ' -f1 <<<"$secrets" | tr '\n' ' ')"
verdict=0
aks_invoke "$RESOURCE_GROUP" "$CLUSTER" "$SCRIPT" "sh sync-secrets.sh" || verdict=$?
if [[ "$verdict" -ne 0 ]]; then
	echo "sync-secrets.sh: the synced Secrets in ${NAMESPACE} do not hold the keys the render declares, above." >&2
	remediation "Nothing else was applied. Check that every vault object the SecretProviderClass lists exists" \
		"and that ${MOUNTER} mounts it (kubectl -n ${NAMESPACE} describe pod -l app.kubernetes.io/name=${MOUNTER}), then deploy again."
	exit 1
fi
