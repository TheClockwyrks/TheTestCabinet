#!/usr/bin/env bash
# Table test for retire-legacy-backend.sh. Run it directly: ./retire-legacy-backend.test.sh
#
# No case reaches Azure. Each builds a throwaway repository holding the script and
# lib.sh, with a stub az first on PATH that records its arguments and a copy of the
# file it was handed, and answers with the exit code the case declares. The subject
# is the command the script sends and where it sends it.
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

check_failed() { # label status
	if [ "$2" -ne 0 ]; then
		ok "$1"
	else
		bad "$1" "expected a non-zero exit" "got exit 0"
	fi
}

if ! command -v jq >/dev/null 2>&1; then
	echo "jq is not installed here; skipping the retire-legacy-backend test."
	exit 0
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

fresh_repo() {
	local repo
	repo="$(mktemp -d "$tmp/repoXXXXXX")"
	mkdir -p "$repo/scripts/ci" "$repo/bin" "$repo/sent"
	cp "$CI_DIR/lib.sh" "$CI_DIR/retire-legacy-backend.sh" "$repo/scripts/ci/"

	# Records each invocation's arguments and keeps the file it uploads, then
	# answers with STUB_AZ_EXIT_CODE; STUB_AZ_BROKEN answers no result at all.
	cat >"$repo/bin/az" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >>"$STUB_AZ_LOG"
while [ $# -gt 0 ]; do
	if [ "$1" = "--file" ]; then cp "$2" "$STUB_SENT/"; fi
	shift
done
if [ -n "${STUB_AZ_BROKEN:-}" ]; then
	echo "ERROR: (AuthorizationFailed) the stub refuses" >&2
	exit 1
fi
printf '{"exitCode": %s, "id": "stub", "logs": "deleted", "provisioningState": "Succeeded"}\n' "${STUB_AZ_EXIT_CODE:-0}"
STUB
	chmod +x "$repo/bin/az"
	printf '%s' "$repo"
}

run() { # repo [env-assignment...]
	local repo="$1"
	shift
	(
		cd / || exit 1
		env PATH="$repo/bin:$PATH" STUB_AZ_LOG="$repo/az.log" STUB_SENT="$repo/sent" \
			"$@" "$repo/scripts/ci/retire-legacy-backend.sh" 2>&1
	)
}

echo "--- the staging defaults ---"

repo="$(fresh_repo)"
out="$(run "$repo")"
status=$?
check_equal "passes" 0 "$status"
invocation="$(cat "$repo/az.log")"
check_contains "names the staging resource group" "--resource-group testcabinet-staging-westus2-rg" "$invocation"
check_contains "names the staging cluster" "--name testcabinet-staging-westus2-aks" "$invocation"
check_contains "runs the file it sends" "--command sh retire-legacy-backend.sh" "$invocation"
sent="$(cat "$repo/sent/retire-legacy-backend.sh" 2>/dev/null)"
check_contains "deletes the legacy Deployment, idempotently, and waits for its pods" \
	"kubectl -n tcab-staging delete deployment tcab-backend --ignore-not-found --cascade=foreground --wait=true" "$sent"
check_contains "says what it did" "The legacy Deployment tcab-backend is not in tcab-staging." "$out"

echo "--- the environment names another namespace ---"

repo="$(fresh_repo)"
out="$(run "$repo" THE_TEST_CABINET_RESOURCE_GROUP=testcabinet-prod-westus2-rg \
	THE_TEST_CABINET_CLUSTER=testcabinet-prod-westus2-aks THE_TEST_CABINET_NAMESPACE=tcab-prod)"
status=$?
check_equal "passes" 0 "$status"
check_contains "names the prod cluster" "--name testcabinet-prod-westus2-aks" "$(cat "$repo/az.log")"
check_contains "deletes from tcab-prod" "kubectl -n tcab-prod delete deployment tcab-backend" \
	"$(cat "$repo/sent/retire-legacy-backend.sh" 2>/dev/null)"

echo "--- the command fails in the cluster ---"

repo="$(fresh_repo)"
out="$(run "$repo" STUB_AZ_EXIT_CODE=1)"
status=$?
check_failed "fails" "$status"
check_contains "names the command that retires it by hand" "delete deployment tcab-backend --ignore-not-found" "$out"

echo "--- the invocation never reaches the cluster ---"

repo="$(fresh_repo)"
out="$(run "$repo" STUB_AZ_BROKEN=1)"
status=$?
check_failed "fails" "$status"
check_contains "says it never ran" "never ran" "$out"

echo "--- --dry-run ---"

repo="$(fresh_repo)"
out="$(cd / && env PATH="$repo/bin:$PATH" STUB_AZ_LOG="$repo/az.log" STUB_SENT="$repo/sent" \
	THE_TEST_CABINET_NAMESPACE=tcab-prod "$repo/scripts/ci/retire-legacy-backend.sh" --dry-run 2>&1)"
status=$?
check_equal "passes" 0 "$status"
check_contains "prints the command" "kubectl -n tcab-prod delete deployment tcab-backend --ignore-not-found" "$out"
check_equal "reaches no cluster" "" "$(cat "$repo/az.log" 2>/dev/null)"

echo "--- an argument ---"

repo="$(fresh_repo)"
out="$(cd / && env PATH="$repo/bin:$PATH" STUB_AZ_LOG="$repo/az.log" STUB_SENT="$repo/sent" \
	"$repo/scripts/ci/retire-legacy-backend.sh" staging 2>&1)"
status=$?
check_failed "fails" "$status"
check_contains "prints the usage" "usage: scripts/ci/retire-legacy-backend.sh [--dry-run]" "$out"
check_equal "reaches no cluster" "" "$(cat "$repo/az.log" 2>/dev/null)"

echo
echo "retire-legacy-backend.test.sh: ${pass} passed, ${fail} failed"
[ "$fail" -eq 0 ]
