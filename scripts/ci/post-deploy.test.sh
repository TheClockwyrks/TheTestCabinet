#!/usr/bin/env bash
# Table test for post-deploy.sh. Run it directly: ./post-deploy.test.sh
#
# Stubs of settle-workloads.sh and catalog-ingest.sh beside a copy of the script
# record the arguments and the THE_TEST_CABINET_* variables they were given, and
# exit with the status the case declares. The subject is that the hook hands the
# commit and the variables on, runs both whatever became of the first, and passes a
# failure of either back to the template's deploy.sh.
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

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

COMMIT="0123456789abcdef0123456789abcdef01234567"

fresh_repo() {
	local repo
	repo="$(mktemp -d "$tmp/repoXXXXXX")"
	mkdir -p "$repo/scripts/ci"
	cp "$CI_DIR/post-deploy.sh" "$repo/scripts/ci/"
	cat >"$repo/scripts/ci/settle-workloads.sh" <<'STUB'
#!/usr/bin/env bash
{
	printf 'args: %s\n' "$*"
	printf 'namespace: %s\n' "${THE_TEST_CABINET_NAMESPACE:-}"
	printf 'timeout: %s\n' "${THE_TEST_CABINET_ROLLOUT_TIMEOUT:-}"
} >"$(dirname "$0")/settle.log"
exit "${STUB_SETTLE_EXIT:-0}"
STUB
	cat >"$repo/scripts/ci/catalog-ingest.sh" <<'STUB'
#!/usr/bin/env bash
{
	printf 'args: %s\n' "$*"
	printf 'namespace: %s\n' "${THE_TEST_CABINET_NAMESPACE:-}"
} >"$(dirname "$0")/catalog.log"
exit "${STUB_CATALOG_EXIT:-0}"
STUB
	chmod +x "$repo/scripts/ci/settle-workloads.sh" "$repo/scripts/ci/catalog-ingest.sh"
	printf '%s' "$repo"
}

echo "--- the siblings settle ---"

repo="$(fresh_repo)"
(cd / && env THE_TEST_CABINET_NAMESPACE=tcab-staging THE_TEST_CABINET_ROLLOUT_TIMEOUT=600s \
	"$repo/scripts/ci/post-deploy.sh" "$COMMIT")
status=$?
check_equal "passes" 0 "$status"
log="$(cat "$repo/scripts/ci/settle.log" 2>/dev/null)"
check_equal "hands on the commit alone" "args: $COMMIT" "$(sed -n 1p <<<"$log")"
check_contains "hands on the namespace" "namespace: tcab-staging" "$log"
check_contains "hands on the rollout timeout" "timeout: 600s" "$log"
catalog="$(cat "$repo/scripts/ci/catalog.log" 2>/dev/null)"
check_equal "then reads the ingest of the namespace's environment" "args: verify staging" "$(sed -n 1p <<<"$catalog")"
check_contains "in the namespace it was given" "namespace: tcab-staging" "$catalog"

echo "--- a sibling does not settle ---"

repo="$(fresh_repo)"
(cd / && env STUB_SETTLE_EXIT=3 "$repo/scripts/ci/post-deploy.sh" "$COMMIT")
status=$?
check_equal "passes the exit code back" 3 "$status"
check_equal "and still reads the ingest" "args: verify staging" "$(sed -n 1p "$repo/scripts/ci/catalog.log" 2>/dev/null)"

echo "--- the sidecar did not ingest ---"

repo="$(fresh_repo)"
(cd / && env STUB_CATALOG_EXIT=1 "$repo/scripts/ci/post-deploy.sh" "$COMMIT")
status=$?
check_equal "fails though every sibling settled" 1 "$status"

repo="$(fresh_repo)"
(cd / && env THE_TEST_CABINET_NAMESPACE=tcab-prod "$repo/scripts/ci/post-deploy.sh" "$COMMIT")
check_equal "another namespace names its own environment" "args: verify prod" "$(sed -n 1p "$repo/scripts/ci/catalog.log" 2>/dev/null)"

echo "--- no commit ---"

repo="$(fresh_repo)"
out="$(cd / && "$repo/scripts/ci/post-deploy.sh" 2>&1)"
status=$?
check_equal "fails" 1 "$status"
check_contains "prints the usage" "usage: scripts/ci/post-deploy.sh <commit>" "$out"
if [ -e "$repo/scripts/ci/settle.log" ] || [ -e "$repo/scripts/ci/catalog.log" ]; then
	bad "settles nothing" "settle-workloads.sh or catalog-ingest.sh ran"
else
	ok "settles nothing"
fi

echo
echo "post-deploy.test.sh: ${pass} passed, ${fail} failed"
[ "$fail" -eq 0 ]
