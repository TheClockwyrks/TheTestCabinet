#!/usr/bin/env bash
# Table test for deploy-preflight.sh. Run it directly: ./deploy-preflight.test.sh
#
# A stub catalog-ingest.sh beside a copy of the script records the arguments it was
# given and exits with the status the case declares. The subject is that the hook
# asks for the preflight of the environment its namespace names, with the commit,
# and passes the verdict back to the template's deploy.sh.
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

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

COMMIT="0123456789abcdef0123456789abcdef01234567"

fresh_repo() {
	local repo
	repo="$(mktemp -d "$tmp/repoXXXXXX")"
	mkdir -p "$repo/scripts/ci"
	cp "$CI_DIR/deploy-preflight.sh" "$repo/scripts/ci/"
	cat >"$repo/scripts/ci/catalog-ingest.sh" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$*" >"$(dirname "$0")/catalog.log"
exit "${STUB_CATALOG_EXIT:-0}"
STUB
	chmod +x "$repo/scripts/ci/catalog-ingest.sh"
	printf '%s' "$repo"
}

echo "--- the catalog can be fetched ---"

repo="$(fresh_repo)"
(cd / && env -u THE_TEST_CABINET_NAMESPACE "$repo/scripts/ci/deploy-preflight.sh" "$COMMIT")
check_equal "passes" 0 "$?"
check_equal "asks for staging's preflight, with the commit" "preflight staging $COMMIT" \
	"$(cat "$repo/scripts/ci/catalog.log" 2>/dev/null)"

repo="$(fresh_repo)"
(cd / && env THE_TEST_CABINET_NAMESPACE=tcab-prod "$repo/scripts/ci/deploy-preflight.sh" "$COMMIT")
check_equal "another namespace names its own environment" "preflight prod $COMMIT" \
	"$(cat "$repo/scripts/ci/catalog.log" 2>/dev/null)"

echo "--- the catalog cannot be fetched ---"

repo="$(fresh_repo)"
(cd / && env STUB_CATALOG_EXIT=1 "$repo/scripts/ci/deploy-preflight.sh" "$COMMIT")
check_equal "passes the failure back" 1 "$?"

echo "--- no commit ---"

repo="$(fresh_repo)"
out="$(cd / && "$repo/scripts/ci/deploy-preflight.sh" 2>&1)"
check_equal "fails" 1 "$?"
check_equal "with the usage" "usage: scripts/ci/deploy-preflight.sh <commit>" "$out"
if [ -e "$repo/scripts/ci/catalog.log" ]; then
	bad "checks nothing" "catalog-ingest.sh ran"
else
	ok "checks nothing"
fi

echo
echo "deploy-preflight.test.sh: ${pass} passed, ${fail} failed"
[ "$fail" -eq 0 ]
