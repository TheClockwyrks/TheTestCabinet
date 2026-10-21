#!/usr/bin/env bash
# Test for catalog-fixture.sh. Run it directly: ./catalog-fixture.test.sh
#
# The fixture is what three other tests stand on, so this holds it to what they
# assume: both catalog branches sit at one commit that pins cold storage through a
# relative `.gitmodules` URL, the pinned commit is served by its id, and
# catalog_fixture_unpin moves the branches onto a pin nothing holds.
set -uo pipefail

CI_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/ci/catalog-fixture.sh
source "${CI_DIR}/catalog-fixture.sh"
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

if ! command -v git >/dev/null 2>&1; then
	echo "git is not installed here; skipping the catalog-fixture test."
	exit 0
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

catalog_fixture "$tmp"
mirror="$tmp/TheTestCabinet.git"

check_equal "the mirror's URL is a file:// one" "file://$mirror" "$CATALOG_REPO"
for branch in staging master; do
	check_equal "$branch is at the tip" "$CATALOG_TIP" "$(git -C "$mirror" rev-parse "refs/heads/$branch")"
done
check_equal "the tip pins cold storage as a submodule" "160000 commit $CATALOG_PIN" \
	"$(git -C "$mirror" ls-tree "$CATALOG_TIP" cold-storage | cut -f1)"
check_equal "at a URL relative to the mirror" "../cold-storage" \
	"$(git -C "$mirror" cat-file blob "$CATALOG_TIP:.gitmodules" | git config --file - --get submodule.cold-storage.url)"
git init --quiet "$tmp/probe"
git -C "$tmp/probe" fetch --quiet --depth 1 "file://$tmp/cold-storage" "$CATALOG_PIN"
check_equal "cold storage serves the pinned commit by its id" 0 "$?"

good="$CATALOG_PIN"
catalog_fixture_unpin "$tmp"
check_equal "an unpin moves the branches" "$CATALOG_TIP" "$(git -C "$mirror" rev-parse refs/heads/staging)"
if [ "$CATALOG_PIN" != "$good" ] && ! git -C "$tmp/cold-storage" cat-file -e "$CATALOG_PIN" 2>/dev/null; then
	ok "onto a pin cold storage does not hold"
else
	bad "onto a pin cold storage does not hold" "pinned: $CATALOG_PIN"
fi

echo
echo "catalog-fixture.test.sh: ${pass} passed, ${fail} failed"
[ "$fail" -eq 0 ]
