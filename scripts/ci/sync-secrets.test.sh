#!/usr/bin/env bash
# Table test for sync-secrets.sh. Run it directly: ./sync-secrets.test.sh
#
# No case reaches Azure or a cluster. Each builds a throwaway repository holding the
# script and lib.sh, with a stub az first on PATH that records its arguments and
# keeps the file it was handed. The subject is twofold: the command the script sends
# and where, and what that command does, which each case runs with sh against a
# stub kubectl over a directory of Secrets (one file per Secret, holding its keys as
# the go-template lists them) and a stub sleep that returns at once.
set -uo pipefail

CI_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
pass=0
fail=0

ok() { pass=$((pass + 1)); printf '  ok   %s\n' "$1"; }
bad() {
	fail=$((fail + 1))
	printf 'FAIL  %s\n' "$1"
	shift
	printf '        %s\n' "$@"
}

check_equal() { # label expected actual
	if [ "$2" = "$3" ]; then
		ok "$1"
	else
		bad "$1" "expected: $2" "got:      ${3:-<empty>}"
	fi
}

check_contains() { # label needle haystack
	if grep -qF -- "$2" <<<"$3"; then
		ok "$1"
	else
		bad "$1" "expected output containing: $2" "got: ${3:-<empty>}"
	fi
}

check_lacks() { # label needle haystack
	if grep -qF -- "$2" <<<"$3"; then
		bad "$1" "expected output without: $2" "got: $3"
	else
		ok "$1"
	fi
}

check_failed() { # label status
	if [ "$2" -ne 0 ]; then
		ok "$1"
	else
		bad "$1" "expected a non-zero exit" "got exit 0"
	fi
}

if ! command -v jq >/dev/null 2>&1; then
	echo "jq is not installed here; skipping the sync-secrets test."
	exit 0
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# A render as kustomize prints it: a Deployment, then the class, whose Secrets list
# their keys out of byte order.
RENDER="$tmp/render.yaml"
cat >"$RENDER" <<'YAML'
apiVersion: apps/v1
kind: Deployment
metadata:
  name: tcab-artifacts
  namespace: tcab-staging
spec:
  template:
    spec:
      containers:
      - env:
        - name: TCAB_R2_BUCKET
          valueFrom:
            secretKeyRef:
              key: TCAB_R2_BUCKET
              name: tcab-artifacts-secrets
---
apiVersion: secrets-store.csi.x-k8s.io/v1
kind: SecretProviderClass
metadata:
  name: tcab-keyvault
  namespace: tcab-staging
spec:
  parameters:
    objects: |
      array:
        - |
          objectName: tcab-r2-bucket
          objectType: secret
  provider: azure
  secretObjects:
  - data:
    - key: TCAB_BACKEND_SERVICE_TOKEN
      objectName: tcab-backend-service-token
    - key: TCAB_BACKEND_DATABASE_URL
      objectName: tcab-backend-database-url
    secretName: tcab-backend-secrets
    type: Opaque
  - data:
    - key: TCAB_R2_SECRET_ACCESS_KEY
      objectName: tcab-r2-secret-access-key
    - key: TCAB_R2_BUCKET
      objectName: tcab-r2-bucket
    secretName: tcab-artifacts-secrets
    type: Opaque
---
apiVersion: v1
kind: Service
metadata:
  name: tcab-web
  namespace: tcab-staging
YAML

BACKEND_KEYS="TCAB_BACKEND_DATABASE_URL TCAB_BACKEND_SERVICE_TOKEN "
ARTIFACTS_KEYS="TCAB_R2_BUCKET TCAB_R2_SECRET_ACCESS_KEY "

fresh_repo() {
	local repo
	repo="$(mktemp -d "$tmp/repoXXXXXX")"
	mkdir -p "$repo/scripts/ci" "$repo/bin" "$repo/sent" "$repo/cluster/secrets" "$repo/cluster/vault"
	cp "$CI_DIR/lib.sh" "$CI_DIR/sync-secrets.sh" "$repo/scripts/ci/"

	cat >"$repo/bin/az" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >>"$STUB_AZ_LOG"
while [ $# -gt 0 ]; do
	if [ "$1" = "--file" ]; then cp "$2" "$STUB_SENT/"; fi
	shift
done
printf '{"exitCode": %s, "id": "stub", "logs": "synced", "provisioningState": "Succeeded"}\n' "${STUB_AZ_EXIT_CODE:-0}"
STUB

	# The cluster: cluster/secrets/<name> holds a Secret's keys; cluster/mounter marks
	# that tcab-keyvault-sync exists; cluster/vault/<name> is what the driver writes
	# for <name> when the mounter restarts, unless STUB_NO_SYNC is set.
	cat >"$repo/bin/kubectl" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail
state="$STUB_CLUSTER"
printf '%s\n' "$*" >>"$state/kubectl.log"
[ "$1" = "-n" ] && shift 2
case "$1 $2" in
	"apply -f") cat >"$state/applied.yaml" ;;
	"get secret")
		[ -f "$state/secrets/$3" ] || exit 0
		case "$*" in
			*"-o name"*) echo "secret/$3" ;;
			*) printf '%s' "$(cat "$state/secrets/$3")" ;;
		esac
		;;
	"delete secret") rm "$state/secrets/$3" ;;
	"get deployment") [ -f "$state/mounter" ] && echo "deployment.apps/$3" || true ;;
	"rollout restart")
		if [ -z "${STUB_NO_SYNC:-}" ]; then
			for declared in "$state"/vault/*; do
				name="$(basename "$declared")"
				[ -f "$state/secrets/$name" ] || cp "$declared" "$state/secrets/$name"
			done
		fi
		;;
	"rollout status" | "describe deployment/tcab-keyvault-sync") ;;
	*) echo "kubectl stub: $*" >&2; exit 1 ;;
esac
STUB
	printf '#!/bin/sh\nexit 0\n' >"$repo/bin/sleep"
	chmod +x "$repo/bin/az" "$repo/bin/kubectl" "$repo/bin/sleep"
	printf '%s' "$BACKEND_KEYS" >"$repo/cluster/vault/tcab-backend-secrets"
	printf '%s' "$ARTIFACTS_KEYS" >"$repo/cluster/vault/tcab-artifacts-secrets"
	printf '%s' "$repo"
}

run() { # repo render [env-assignment...]
	local repo="$1" render="$2"
	shift 2
	(
		cd / || exit 1
		env PATH="$repo/bin:$PATH" STUB_AZ_LOG="$repo/az.log" STUB_SENT="$repo/sent" \
			"$@" "$repo/scripts/ci/sync-secrets.sh" "$render" 2>&1
	)
}

# Runs the command the script sent, as the cluster would.
in_cluster() { # repo [env-assignment...]
	local repo="$1"
	shift
	(
		cd "$repo/sent" || exit 1
		env PATH="$repo/bin:$PATH" STUB_CLUSTER="$repo/cluster" "$@" sh sync-secrets.sh 2>&1
	)
}

echo "--- the command it sends ---"

repo="$(fresh_repo)"
out="$(run "$repo" "$RENDER")"
status=$?
check_equal "passes" 0 "$status"
invocation="$(cat "$repo/az.log")"
check_contains "names the staging resource group" "--resource-group testcabinet-staging-westus2-rg" "$invocation"
check_contains "names the staging cluster" "--name testcabinet-staging-westus2-aks" "$invocation"
check_contains "runs the file it sends" "--command sh sync-secrets.sh" "$invocation"
sent="$(cat "$repo/sent/sync-secrets.sh" 2>/dev/null)"
check_contains "works in tcab-staging" "ns=tcab-staging" "$sent"
check_contains "applies the class" "kind: SecretProviderClass" "$sent"
check_lacks "and nothing else of the render" "kind: Service" "$sent"
check_contains "declares the backend's keys in byte order" \
	"tcab-backend-secrets) echo '${BACKEND_KEYS}' ;;" "$sent"
check_contains "and the artifacts service's" \
	"tcab-artifacts-secrets) echo '${ARTIFACTS_KEYS}' ;;" "$sent"
check_contains "names the Secrets it syncs" "tcab-artifacts-secrets tcab-backend-secrets" "$out"

echo "--- every Secret already holds its keys ---"

repo="$(fresh_repo)"
run "$repo" "$RENDER" >/dev/null
cp "$repo/cluster/vault/"* "$repo/cluster/secrets/"
touch "$repo/cluster/mounter"
out="$(in_cluster "$repo")"
status=$?
check_equal "passes" 0 "$status"
check_contains "applies the class" "name: tcab-keyvault" "$(cat "$repo/cluster/applied.yaml" 2>/dev/null)"
check_contains "says so" "Every synced Secret holds the keys the class declares." "$out"
check_lacks "deletes nothing" "delete" "$(cat "$repo/cluster/kubectl.log")"
check_lacks "restarts nothing" "rollout" "$(cat "$repo/cluster/kubectl.log")"

echo "--- a Secret with a key the class dropped, and a new Secret ---"

repo="$(fresh_repo)"
run "$repo" "$RENDER" >/dev/null
printf '%s' "TCAB_BACKEND_DATABASE_URL TCAB_BACKEND_SERVICE_TOKEN TCAB_R2_BUCKET " \
	>"$repo/cluster/secrets/tcab-backend-secrets"
touch "$repo/cluster/mounter"
out="$(in_cluster "$repo")"
status=$?
check_equal "passes" 0 "$status"
log="$(cat "$repo/cluster/kubectl.log")"
check_contains "deletes the Secret whose keys differ" "-n tcab-staging delete secret tcab-backend-secrets" "$log"
check_contains "restarts the mounter" "-n tcab-staging rollout restart deployment/tcab-keyvault-sync" "$log"
check_contains "and waits for it" "-n tcab-staging rollout status deployment/tcab-keyvault-sync" "$log"
check_equal "the backend's Secret holds the declared keys" "$BACKEND_KEYS" \
	"$(cat "$repo/cluster/secrets/tcab-backend-secrets")"
check_equal "the artifacts Secret exists with its keys" "$ARTIFACTS_KEYS" \
	"$(cat "$repo/cluster/secrets/tcab-artifacts-secrets")"
check_contains "says what it synced" "Synced tcab-artifacts-secrets tcab-backend-secrets" "$out"

echo "--- the restarted mounter syncs nothing ---"

repo="$(fresh_repo)"
run "$repo" "$RENDER" >/dev/null
cp "$repo/cluster/vault/tcab-backend-secrets" "$repo/cluster/secrets/"
touch "$repo/cluster/mounter"
out="$(in_cluster "$repo" STUB_NO_SYNC=1)"
status=$?
check_failed "fails" "$status"
check_contains "naming the Secret" "but tcab-artifacts-secrets did not sync" "$out"

echo "--- a namespace without the mounter yet ---"

repo="$(fresh_repo)"
run "$repo" "$RENDER" >/dev/null
out="$(in_cluster "$repo")"
status=$?
check_equal "passes" 0 "$status"
check_contains "leaves the sync to the apply" "No tcab-keyvault-sync in tcab-staging yet" "$out"
check_lacks "restarts nothing" "rollout" "$(cat "$repo/cluster/kubectl.log")"

echo "--- the environment names another namespace ---"

repo="$(fresh_repo)"
out="$(run "$repo" "$RENDER" THE_TEST_CABINET_RESOURCE_GROUP=testcabinet-prod-westus2-rg \
	THE_TEST_CABINET_CLUSTER=testcabinet-prod-westus2-aks THE_TEST_CABINET_NAMESPACE=tcab-prod)"
status=$?
check_equal "passes" 0 "$status"
check_contains "names the prod cluster" "--name testcabinet-prod-westus2-aks" "$(cat "$repo/az.log")"
check_contains "works in tcab-prod" "ns=tcab-prod" "$(cat "$repo/sent/sync-secrets.sh" 2>/dev/null)"

echo "--- a render without a SecretProviderClass ---"

repo="$(fresh_repo)"
grep -v SecretProviderClass "$RENDER" | sed '/^  secretObjects:/,$d' >"$tmp/plain.yaml"
out="$(run "$repo" "$tmp/plain.yaml")"
status=$?
check_equal "passes" 0 "$status"
check_contains "says so" "declares no SecretProviderClass" "$out"
check_equal "reaches no cluster" "" "$(cat "$repo/az.log" 2>/dev/null)"

echo "--- the command fails in the cluster ---"

repo="$(fresh_repo)"
out="$(run "$repo" "$RENDER" STUB_AZ_EXIT_CODE=1)"
status=$?
check_failed "fails" "$status"
check_contains "says what to check" "describe pod -l app.kubernetes.io/name=tcab-keyvault-sync" "$out"

echo "--- --dry-run ---"

repo="$(fresh_repo)"
out="$(cd / && env PATH="$repo/bin:$PATH" STUB_AZ_LOG="$repo/az.log" STUB_SENT="$repo/sent" \
	"$repo/scripts/ci/sync-secrets.sh" --dry-run "$RENDER" 2>&1)"
status=$?
check_equal "passes" 0 "$status"
check_contains "prints the command" "check tcab-artifacts-secrets" "$out"
check_equal "reaches no cluster" "" "$(cat "$repo/az.log" 2>/dev/null)"

echo "--- no render ---"

repo="$(fresh_repo)"
out="$(cd / && env PATH="$repo/bin:$PATH" "$repo/scripts/ci/sync-secrets.sh" 2>&1)"
status=$?
check_failed "fails" "$status"
check_contains "prints the usage" "usage: scripts/ci/sync-secrets.sh [--dry-run] <rendered-manifest>" "$out"

echo
echo "sync-secrets.test.sh: ${pass} passed, ${fail} failed"
[ "$fail" -eq 0 ]
