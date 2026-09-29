#!/usr/bin/env bash
# Table test for deploy.sh. Run it directly: ./deploy.test.sh
#
# No case reaches a cluster or Azure. Each builds a throwaway repository
# holding the script, the deployed overlay's empty directory and stubs of kubectl
# and az first on PATH: the kubectl stub renders whatever the layer names, and
# the az stub records its arguments and answers with the exit code the case
# declares.
#
# The subject is everything the script does around the cluster: what it refuses
# to roll, the layer it renders, the command it hands the cluster, the verdict it
# reads out of the result, and what it does when the rollout fails.
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
		bad "$1" "expected no output containing: $2" "got: ${3:-<empty>}"
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
	echo "jq is not installed here; skipping the deploy test."
	exit 0
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

COMMIT="0123456789abcdef0123456789abcdef01234567"
OVERLAY="deployments/k8s/overlays/staging"
REGISTRY="testcabinet.azurecr.io"
GROUP="tools-case-rg"
CLUSTER="tools-case-aks"

# A repository holding the script, the overlay directory the layer sits beside
# and the two stubs.
fresh_repo() {
	local repo
	repo="$(mktemp -d "$tmp/repoXXXXXX")"
	mkdir -p "$repo/scripts/ci" "$repo/bin" "$repo/$OVERLAY"
	cp "$CI_DIR/lib.sh" "$CI_DIR/deploy.sh" "$repo/scripts/ci/"

	# Answers `kustomize <dir>` with one `image:` line per image the layer
	# names, at the tag it sets, and keeps a copy of the layer for the case to
	# read. STUB_RENDER_DROP names an image to leave out of the render, which
	# may be every image the layer names.
	cat >"$repo/bin/kubectl" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail
[ "$1" = "kustomize" ] || { echo "kubectl stub: $*" >&2; exit 1; }
cp "$2/kustomization.yaml" "$STUB_LAYER_COPY"
awk '
	/^  - name: / { name = $3 }
	/^    newTag: / { tag = $2; gsub(/"/, "", tag); print "        image: " name ":" tag }
' "$2/kustomization.yaml" | { grep -v -- "${STUB_RENDER_DROP:-<none>}" || true; }
STUB
	chmod +x "$repo/bin/kubectl"

	# Records every invocation's arguments, one per line, and answers the
	# result STUB_AZ_EXIT_CODE declares. STUB_AZ_BROKEN makes the invocation
	# itself fail without a result. STUB_AZ_RUNNING makes the first invocation
	# answer with its command still running, and that many reads of the result
	# answer the same before the result carries the exit code. The two forms
	# are the CLI's own: the invocation answers JSON carrying the id, and a
	# read of a running result answers two lines of text whatever format was
	# asked for.
	cat >"$repo/bin/az" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >>"$STUB_AZ_LOG"
n="$(wc -l <"$STUB_AZ_LOG")"
if [ -n "${STUB_AZ_BROKEN:-}" ]; then
	echo "ERROR: (AuthorizationFailed) the stub refuses" >&2
	exit 1
fi
if [ "$n" -le "${STUB_AZ_RUNNING:-0}" ]; then
	if [ "$1 $2 $3" = "aks command result" ]; then
		printf 'command id: stub-command, started at: 2026-09-19T22:53:40Z, status: Running\n'
		printf 'Please use command "az aks command result -g rg -n aks -i stub-command" to get the future execution result\n'
	else
		printf '{\n  "exitCode": null,\n  "id": "stub-command",\n  "logs": null,\n  "provisioningState": "Running"\n}\n'
	fi
	exit 0
fi
code="${STUB_AZ_EXIT_CODE:-0}"
[ "$n" -gt $((${STUB_AZ_RUNNING:-0} + 1)) ] && code=0
printf '{\n  "exitCode": %s,\n  "id": "stub-command",\n  "logs": "line one of run %s\\nline two",\n  "provisioningState": "Succeeded"\n}\n' "$code" "$n"
STUB
	chmod +x "$repo/bin/az"

	printf '%s' "$repo"
}

# Runs the script in $1 with the environment assignments and arguments that
# follow, from a working directory outside the repository. The resource group
# and the cluster are the case's unless an assignment names another.
run() { # repo [env-assignment...] [--] [argument...]
	local repo="$1"
	shift
	(
		cd / || exit 1
		env PATH="$repo/bin:$PATH" \
			STUB_AZ_LOG="$repo/az.log" \
			STUB_LAYER_COPY="$repo/layer.yaml" \
			THE_TEST_CABINET_RESOURCE_GROUP="$GROUP" \
			THE_TEST_CABINET_CLUSTER="$CLUSTER" \
			"$@" 2>&1
	)
}

# The `--command` argument of the nth az invocation.
command_of() { # repo n
	sed -n "${2}p" "$1/az.log" | sed 's/.*--command //; s/ -o json$//'
}

echo "--- no commit ---"

repo="$(fresh_repo)"
out="$(run "$repo" "$repo/scripts/ci/deploy.sh")"
status=$?
check_failed "fails" "$status"
check_contains "prints the usage" "Usage: scripts/ci/deploy.sh <commit>" "$out"
check_equal "reaches no cluster" "" "$(cat "$repo/az.log" 2>/dev/null)"

echo "--- a value that is not a commit ---"

repo="$(fresh_repo)"
out="$(run "$repo" "$repo/scripts/ci/deploy.sh" abc123)"
status=$?
check_failed "fails" "$status"
check_contains "names the value" "'abc123' is not a commit" "$out"
check_contains "names the registry's tag list" "az acr repository show-tags --name ${REGISTRY%%.*}" "$out"

echo "--- the answers are the defaults ---"

repo="$(fresh_repo)"
out="$(cd / && env PATH="$repo/bin:$PATH" STUB_AZ_LOG="$repo/az.log" STUB_LAYER_COPY="$repo/layer.yaml" "$repo/scripts/ci/deploy.sh" "$COMMIT" 2>&1)"
status=$?
check_equal "a run naming nothing passes" 0 "$status"
invocation="$(sed -n 1p "$repo/az.log")"
check_contains "it names the answered resource group" "--resource-group testcabinet-staging-westus2-rg " "$invocation"
check_contains "it names the answered cluster" "--name testcabinet-staging-westus2-aks " "$invocation"
check_contains "the layer names the answered registry" "name: $REGISTRY/the-test-cabinet-backend" "$(cat "$repo/layer.yaml")"
check_contains "it waits in the answered namespace" "kubectl -n tcab-staging rollout status" "$(command_of "$repo" 1)"
check_lacks "it names no placeholder" "REPLACE_" "$out$(cat "$repo/az.log")"

echo "--- kubectl is not installed ---"

repo="$(fresh_repo)"
rm "$repo/bin/kubectl"
# A PATH holding the stubs and the system directories alone, so a kubectl a
# developer installed under their home does not answer for the missing one.
out="$(cd / && env PATH="$repo/bin:/usr/bin:/bin" STUB_AZ_LOG="$repo/az.log" STUB_LAYER_COPY="$repo/layer.yaml" \
	THE_TEST_CABINET_RESOURCE_GROUP="$GROUP" THE_TEST_CABINET_CLUSTER="$CLUSTER" "$repo/scripts/ci/deploy.sh" "$COMMIT" 2>&1)"
status=$?
if [ -x /usr/bin/kubectl ] || [ -x /bin/kubectl ]; then
	ok "(kubectl sits in a system directory here, so the missing-tool case is not reached)"
else
	check_failed "fails" "$status"
	check_contains "names the tool" "No kubectl on PATH" "$out"
	check_equal "reaches no cluster" "" "$(cat "$repo/az.log" 2>/dev/null)"
fi

echo "--- a command az stopped waiting on ---"

repo="$(fresh_repo)"
out="$(run "$repo" STUB_AZ_RUNNING=2 AKS_RESULT_POLL_SECONDS=0 "$repo/scripts/ci/deploy.sh" "$COMMIT")"
status=$?
check_equal "passes" 0 "$status"
check_equal "the cluster is reached three times" 3 "$(wc -l <"$repo/az.log")"
check_contains "the first reach invokes the command" "aks command invoke" "$(sed -n 1p "$repo/az.log")"
for n in 2 3; do
	reach="$(sed -n "${n}p" "$repo/az.log")"
	check_contains "reach $n reads the result" "aks command result" "$reach"
	check_contains "reach $n names the command" "--command-id stub-command" "$reach"
	check_contains "reach $n names the cluster" "--name $CLUSTER" "$reach"
done
check_contains "prints what the cluster wrote" "line one of run 3" "$out"
check_contains "reports the commit deployed" "Deployed $COMMIT" "$out"
check_lacks "rolls nothing back" "Rolling back" "$out"

echo "--- a rollout that succeeds ---"

repo="$(fresh_repo)"
out="$(run "$repo" "$repo/scripts/ci/deploy.sh" "$COMMIT")"
status=$?
check_equal "passes" 0 "$status"
layer="$(cat "$repo/layer.yaml")"
check_contains "the layer sits beside the overlay and names it" "- ../staging" "$layer"
check_contains "the layer sets the server image's tag" "name: $REGISTRY/the-test-cabinet-backend" "$layer"
check_equal "the layer names the one image" 1 "$(grep -c '^  - name: ' <<<"$layer")"
check_equal "the tag is the commit" 1 "$(grep -c "newTag: \"$COMMIT\"" <<<"$layer")"
check_equal "the cluster is reached once" 1 "$(wc -l <"$repo/az.log")"
invocation="$(sed -n 1p "$repo/az.log")"
check_contains "the invocation is an aks command" "aks command invoke" "$invocation"
check_contains "it names the resource group" "--resource-group $GROUP" "$invocation"
check_contains "it names the cluster" "--name $CLUSTER" "$invocation"
check_contains "it asks for json" "-o json" "$invocation"
render="$(sed -n 's/.*--file \([^ ]*\) .*/\1/p' "$repo/az.log" | head -n 1)"
command="$(command_of "$repo" 1)"
check_contains "the command applies the file it carried" "kubectl apply -f $(basename "$render")" "$command"
check_contains "the command waits for the server" "kubectl -n tcab-staging rollout status deployment/the-test-cabinet-backend --timeout=300s" "$command"
check_equal "the command waits for the server alone" 1 "$(grep -o 'rollout status deployment/' <<<"$command" | wc -l)"
check_lacks "the command rolls nothing back" "rollout undo" "$command"
check_contains "prints what the cluster wrote" "line one of run 1" "$out"
check_contains "prints the second line on its own" "line two" "$out"
check_contains "reports the commit deployed" "Deployed $COMMIT" "$out"
left=("$repo/$OVERLAY"/../.deploy-*)
if [ ! -e "${left[0]}" ]; then
	ok "removes the layer it rendered"
else
	bad "removes the layer it rendered" "left behind: ${left[*]}"
fi

echo "--- the five values an environment overrides ---"

repo="$(fresh_repo)"
out="$(run "$repo" \
	THE_TEST_CABINET_REGISTRY=example.invalid THE_TEST_CABINET_RESOURCE_GROUP=other-rg THE_TEST_CABINET_CLUSTER=other-aks \
	THE_TEST_CABINET_NAMESPACE=other-ns THE_TEST_CABINET_ROLLOUT_TIMEOUT=10s \
	"$repo/scripts/ci/deploy.sh" "$COMMIT")"
status=$?
check_equal "passes" 0 "$status"
check_contains "the layer names the registry" "name: example.invalid/the-test-cabinet-backend" "$(cat "$repo/layer.yaml")"
invocation="$(sed -n 1p "$repo/az.log")"
check_contains "the resource group" "--resource-group other-rg" "$invocation"
check_contains "the cluster" "--name other-aks" "$invocation"
command="$(command_of "$repo" 1)"
check_contains "the namespace and the timeout" "kubectl -n other-ns rollout status deployment/the-test-cabinet-backend --timeout=10s" "$command"

echo "--- the project's post-deploy hook ---"

# Records its arguments and the values it was given, one per line, and exits
# with STUB_HOOK_EXIT.
write_hook() { # repo
	cat >"$1/scripts/ci/post-deploy.sh" <<'HOOK'
#!/usr/bin/env bash
{
	printf 'args %s\n' "$*"
	printf 'pwd %s\n' "$(pwd -P)"
	printf 'namespace %s\n' "${THE_TEST_CABINET_NAMESPACE:-}"
	printf 'cluster %s\n' "${THE_TEST_CABINET_CLUSTER:-}"
	printf 'registry %s\n' "${THE_TEST_CABINET_REGISTRY:-}"
} >"$STUB_HOOK_LOG"
echo "the hook ran"
exit "${STUB_HOOK_EXIT:-0}"
HOOK
	chmod +x "$1/scripts/ci/post-deploy.sh"
}

repo="$(fresh_repo)"
write_hook "$repo"
out="$(run "$repo" STUB_HOOK_LOG="$repo/hook.log" "$repo/scripts/ci/deploy.sh" "$COMMIT")"
status=$?
check_equal "a hook that passes passes" 0 "$status"
check_contains "it runs once the commit is deployed" "Deployed $COMMIT" "$out"
check_contains "and prints what it wrote" "the hook ran" "$out"
hook="$(cat "$repo/hook.log" 2>/dev/null)"
check_contains "it is given the commit" "args $COMMIT" "$hook"
check_contains "it runs from the repository root" "pwd $(cd "$repo" && pwd -P)" "$hook"
check_contains "it is given the namespace" "namespace tcab-staging" "$hook"
check_contains "it is given the cluster" "cluster $CLUSTER" "$hook"
check_contains "it is given the registry" "registry $REGISTRY" "$hook"

repo="$(fresh_repo)"
write_hook "$repo"
out="$(run "$repo" STUB_HOOK_LOG="$repo/hook.log" STUB_HOOK_EXIT=1 "$repo/scripts/ci/deploy.sh" "$COMMIT")"
status=$?
check_failed "a hook that fails fails the run" "$status"
check_contains "says the deployment stays" "$COMMIT is deployed and stays, but scripts/ci/post-deploy.sh failed" "$out"
check_contains "names the command that runs the hook again" "scripts/ci/post-deploy.sh $COMMIT" "$out"
check_lacks "rolls nothing back" "Rolling back" "$out"
check_equal "the cluster is reached once" 1 "$(wc -l <"$repo/az.log")"

repo="$(fresh_repo)"
write_hook "$repo"
chmod -x "$repo/scripts/ci/post-deploy.sh"
out="$(run "$repo" STUB_HOOK_LOG="$repo/hook.log" "$repo/scripts/ci/deploy.sh" "$COMMIT")"
status=$?
check_failed "a hook that is not executable fails the run" "$status"
check_contains "says so" "scripts/ci/post-deploy.sh is not executable" "$out"
check_lacks "and runs nothing" "the hook ran" "$out"

repo="$(fresh_repo)"
write_hook "$repo"
out="$(run "$repo" STUB_HOOK_LOG="$repo/hook.log" STUB_AZ_EXIT_CODE=1 "$repo/scripts/ci/deploy.sh" "$COMMIT")"
status=$?
check_failed "a rollout that fails fails the run" "$status"
check_lacks "and runs no hook" "the hook ran" "$out"

echo "--- a rollout that fails ---"

repo="$(fresh_repo)"
out="$(run "$repo" STUB_AZ_EXIT_CODE=1 "$repo/scripts/ci/deploy.sh" "$COMMIT")"
status=$?
check_failed "fails" "$status"
check_contains "says the commit did not become ready" "$COMMIT did not become ready. Rolling back." "$out"
check_equal "the cluster is reached a second time" 2 "$(wc -l <"$repo/az.log")"
command="$(command_of "$repo" 2)"
check_contains "the second command describes the project's pods" "describe pods -l app.kubernetes.io/part-of=the-test-cabinet" "$command"
check_contains "it reads the server's log" "logs deployment/the-test-cabinet-backend --tail=100" "$command"
check_contains "it puts the previous server back" "rollout undo deployment/the-test-cabinet-backend" "$command"
check_equal "it puts the server alone back" 1 "$(grep -o 'rollout undo deployment/' <<<"$command" | wc -l)"
check_contains "it waits for the rollback" "rollout status deployment/the-test-cabinet-backend --timeout=300s" "$command"
check_lacks "does not report a deployment" "Deployed $COMMIT" "$out"

echo "--- a command still running when the polls run out ---"

repo="$(fresh_repo)"
out="$(run "$repo" STUB_AZ_RUNNING=5 AKS_RESULT_POLLS=2 AKS_RESULT_POLL_SECONDS=0 "$repo/scripts/ci/deploy.sh" "$COMMIT")"
status=$?
check_failed "fails" "$status"
check_equal "the cluster is reached three times" 3 "$(wc -l <"$repo/az.log")"
check_contains "says the command runs on" "still running after 0 seconds. It runs on" "$out"
check_contains "names the command that reads it back" \
	"az aks command result --resource-group $GROUP --name $CLUSTER --command-id stub-command" "$out"
check_contains "says nothing was rolled back" "Nothing was rolled back" "$out"
check_lacks "rolls nothing back" "Rolling back" "$out"
check_lacks "does not say the command never ran" "never ran" "$out"

echo "--- an invocation that never runs the command ---"

repo="$(fresh_repo)"
out="$(run "$repo" STUB_AZ_BROKEN=1 "$repo/scripts/ci/deploy.sh" "$COMMIT")"
status=$?
check_failed "fails" "$status"
check_contains "prints what az said" "(AuthorizationFailed) the stub refuses" "$out"
check_contains "says the command never ran" "reported no exit code, so the command never ran" "$out"
check_equal "rolls nothing back" 1 "$(wc -l <"$repo/az.log")"

echo "--- a render missing one image ---"

repo="$(fresh_repo)"
out="$(run "$repo" STUB_RENDER_DROP=the-test-cabinet-backend "$repo/scripts/ci/deploy.sh" "$COMMIT")"
status=$?
check_failed "fails" "$status"
check_contains "counts the images it found" "carries 0 of the one image at $COMMIT" "$out"
check_equal "reaches no cluster" "" "$(cat "$repo/az.log" 2>/dev/null)"

printf '\n%d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
