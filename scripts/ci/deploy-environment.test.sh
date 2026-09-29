#!/usr/bin/env bash
# Table test for deploy-environment.sh. Run it directly:
# scripts/ci/deploy-environment.test.sh
#
# No case reaches Azure or a cluster. Each builds a throwaway repository holding
# the script, the template's lib.sh and tcab-lib.sh, a two-overlay k8s tree, and
# stubs of the scripts it hands work to (pin-images.sh, retire-legacy-backend.sh,
# settle-workloads.sh), each recording its arguments and the THE_TEST_CABINET_*
# variables it saw. `kubectl kustomize` prints the overlay's `rendered.yaml`,
# and `az` records the invocation and answers with the exit code the case
# declares. The subject is the order and content of what it does, that the
# checkout's k8s tree is never edited, and each refusal.
set -uo pipefail

CI_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly CI_DIR
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
		bad "$1" "expected no output containing: $2" "got: ${3:-<empty>}"
	else
		ok "$1"
	fi
}

check_exists() { # label path
	if [ -e "$2" ] || [ -L "$2" ]; then
		ok "$1"
	else
		bad "$1" "expected $2 to exist"
	fi
}

check_absent() { # label path
	if [ -e "$2" ] || [ -L "$2" ]; then
		bad "$1" "expected $2 to be gone"
	else
		ok "$1"
	fi
}

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

if ! command -v jq >/dev/null 2>&1; then
	echo "jq is not installed here; skipping the deploy-environment test."
	exit 0
fi

readonly COMMIT="0123456789abcdef0123456789abcdef01234567"

fresh_repo() {
	local repo name environment
	repo="$(mktemp -d "$tmp/repoXXXXXX")"
	mkdir -p "$repo/scripts/ci" "$repo/bin"
	cp "$CI_DIR/deploy-environment.sh" "$CI_DIR/lib.sh" "$CI_DIR/tcab-lib.sh" "$repo/scripts/ci/"
	for environment in staging prod; do
		mkdir -p "$repo/deployments/k8s/overlays/$environment"
		cat >"$repo/deployments/k8s/overlays/$environment/rendered.yaml" <<YAML
apiVersion: apps/v1
kind: Deployment
metadata:
  name: tcab-dispatcher
  namespace: tcab-$environment
---
apiVersion: v1
kind: Service
metadata:
  name: tcab-web
  namespace: tcab-$environment
YAML
	done
	for name in pin-images retire-legacy-backend settle-workloads; do
		cat >"$repo/scripts/ci/$name.sh" <<STUB
#!/usr/bin/env bash
echo "$name \$* [k8s=\${TCAB_K8S_ROOT:-} rg=\${THE_TEST_CABINET_RESOURCE_GROUP:-} cluster=\${THE_TEST_CABINET_CLUSTER:-} ns=\${THE_TEST_CABINET_NAMESPACE:-} timeout=\${THE_TEST_CABINET_ROLLOUT_TIMEOUT:-}]" >>"\$STUB_LOG"
[[ "$name" == pin-images ]] && echo "pinned" >>"\$TCAB_K8S_ROOT/overlays/\$1/rendered.yaml.pins"
exit "\${STUB_EXIT_${name//-/_}:-0}"
STUB
		chmod +x "$repo/scripts/ci/$name.sh"
	done
	cat >"$repo/bin/kubectl" <<'STUB'
#!/usr/bin/env bash
[[ "$1" == kustomize ]] || exit 1
cat "$2/rendered.yaml"
STUB
	cat >"$repo/bin/az" <<'STUB'
#!/usr/bin/env bash
echo "az $*" >>"$STUB_LOG"
jq -n --argjson code "${STUB_AZ_EXIT_CODE:-0}" '{exitCode: $code, id: "stub", logs: "applied", provisioningState: "Succeeded"}'
STUB
	chmod +x "$repo/bin/kubectl" "$repo/bin/az"
	printf '%s' "$repo"
}

run() { # repo [env-assignment...] -- [argument...]
	local repo="$1"
	shift
	local assignments=()
	while [ $# -gt 0 ] && [ "$1" != "--" ]; do
		assignments+=("$1")
		shift
	done
	shift
	: >"$repo/calls.log"
	(cd "$tmp" && env -u TCAB_K8S_ROOT -u THE_TEST_CABINET_RESOURCE_GROUP -u THE_TEST_CABINET_CLUSTER \
		-u THE_TEST_CABINET_NAMESPACE -u THE_TEST_CABINET_ROLLOUT_TIMEOUT \
		PATH="$repo/bin:$PATH" STUB_LOG="$repo/calls.log" "${assignments[@]}" \
		"$repo/scripts/ci/deploy-environment.sh" "$@" 2>&1)
}
calls() { sed "s|/tmp/[^ ]*/k8s|K8S|; s|--file /tmp/[^ ]*/|--file TMP/|" "$1/calls.log"; }

echo "--- a staging deploy ---"
repo="$(fresh_repo)"
out="$(run "$repo" -- staging "$COMMIT")"
check_equal "succeeds" "0" "$?"
check_equal "pins a copy, retires the legacy backend, applies, then settles" \
	"pin-images staging $COMMIT [k8s=K8S rg= cluster= ns= timeout=]
retire-legacy-backend  [k8s= rg=testcabinet-staging-westus2-rg cluster=testcabinet-staging-westus2-aks ns=tcab-staging timeout=600s]
az aks command invoke --resource-group testcabinet-staging-westus2-rg --name testcabinet-staging-westus2-aks --file TMP/tcab-staging.yaml --command kubectl apply -f tcab-staging.yaml -o json
settle-workloads --include-backend $COMMIT [k8s= rg=testcabinet-staging-westus2-rg cluster=testcabinet-staging-westus2-aks ns=tcab-staging timeout=600s]" \
	"$(calls "$repo")"
check_absent "the checkout's overlay is never edited" "$repo/deployments/k8s/overlays/staging/rendered.yaml.pins"
check_contains "and the result is reported" "staging is at $COMMIT" "$out"

echo "--- a prod deploy ---"
repo="$(fresh_repo)"
out="$(run "$repo" -- prod "$COMMIT")"
check_equal "succeeds" "0" "$?"
check_contains "against the prod cluster and namespace" \
	"az aks command invoke --resource-group testcabinet-prod-westus2-rg --name testcabinet-prod-westus2-aks" "$(calls "$repo")"
check_contains "settling in tcab-prod" "ns=tcab-prod timeout=600s" "$(grep '^settle-workloads' "$repo/calls.log")"

echo "--- --render ---"
repo="$(fresh_repo)"
out="$(run "$repo" -- --render staging "$COMMIT")"
check_equal "succeeds" "0" "$?"
check_equal "prints the rendered overlay alone" "$(cat "$repo/deployments/k8s/overlays/staging/rendered.yaml")" "$out"
check_equal "after pinning it" "pin-images" "$(cut -d' ' -f1 "$repo/calls.log")"

echo "--- TCAB_K8S_ROOT ---"
repo="$(fresh_repo)"
mkdir -p "$tmp/caller"
cp -R "$repo/deployments/k8s" "$tmp/caller/other-k8s"
sed -i 's/tcab-web/tcab-other/' "$tmp/caller/other-k8s/overlays/staging/rendered.yaml"
out="$(cd "$tmp/caller" && env PATH="$repo/bin:$PATH" STUB_LOG="$repo/calls.log" TCAB_K8S_ROOT=other-k8s \
	"$repo/scripts/ci/deploy-environment.sh" --render staging "$COMMIT" 2>&1)"
check_equal "a relative tree succeeds" "0" "$?"
check_contains "and is read from the caller's directory" "name: tcab-other" "$out"

echo "--- refusals ---"
repo="$(fresh_repo)"
cat >>"$repo/deployments/k8s/overlays/staging/rendered.yaml" <<'YAML'
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: tcab-reader
YAML
out="$(run "$repo" -- staging "$COMMIT")"
check_equal "a cluster-scoped object fails" "1" "$?"
check_contains "naming it" "cluster-scoped: ClusterRole/tcab-reader" "$out"
check_contains "and where it belongs" "move them under deployments/k8s/cluster/" "$out"
check_lacks "before reaching the cluster" "az " "$(cat "$repo/calls.log")"

repo="$(fresh_repo)"
sed -i 's/namespace: tcab-staging/namespace: default/' "$repo/deployments/k8s/overlays/staging/rendered.yaml"
out="$(run "$repo" -- staging "$COMMIT")"
check_equal "an object in another namespace fails" "1" "$?"
check_contains "naming it" "outside tcab-staging: Deployment/tcab-dispatcher (namespace default)" "$out"

repo="$(fresh_repo)"
out="$(run "$repo" STUB_EXIT_pin_images=1 -- staging "$COMMIT")"
check_equal "a failed pin fails" "1" "$?"
check_contains "saying so" "the staging overlay could not be pinned to $COMMIT" "$out"
check_equal "and goes no further" "pin-images" "$(cut -d' ' -f1 "$repo/calls.log")"

repo="$(fresh_repo)"
out="$(run "$repo" STUB_AZ_EXIT_CODE=1 -- staging "$COMMIT")"
check_equal "a failed apply fails" "1" "$?"
check_contains "saying so" "the apply of $COMMIT to tcab-staging did not succeed" "$out"
check_lacks "without settling" "settle-workloads" "$(cat "$repo/calls.log")"

repo="$(fresh_repo)"
out="$(run "$repo" STUB_EXIT_settle_workloads=1 -- staging "$COMMIT")"
check_equal "workloads that do not settle fail" "1" "$?"
check_contains "saying the environment is not at the commit" "staging is not at $COMMIT" "$out"

repo="$(fresh_repo)"
out="$(run "$repo" -- local "$COMMIT")"
check_equal "another environment fails" "1" "$?"
check_contains "naming it" "unknown environment 'local' (expected staging or prod)" "$out"
out="$(run "$repo" -- staging main)"
check_equal "a ref that is not a commit fails" "1" "$?"
check_contains "naming it" "'main' is not a commit" "$out"
out="$(run "$repo" -- staging)"
check_equal "one argument is a usage error" "1" "$?"
check_contains "which says how to call it" "usage: scripts/ci/deploy-environment.sh [--render] <staging|prod> <commit>" "$out"
check_equal "and no refusal reaches anything" "" "$(cat "$repo/calls.log")"

echo
echo "deploy-environment.test.sh: ${pass} passed, ${fail} failed"
[ "$fail" -eq 0 ]
