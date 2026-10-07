#!/usr/bin/env bash
# Table test for deploy-docs.sh. Run it directly: scripts/ci/deploy-docs.test.sh
#
# A copy of the script runs in a throwaway repository with `npm` and `npx`
# stubbed first on PATH, each recording its arguments and the Cloudflare
# variables it saw. Nothing is built and nothing reaches Cloudflare. The subject
# is which Pages project each branch deploys to, and what is refused.
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

repo="$tmp/repo"
mkdir -p "$repo/scripts/ci" "$repo/bin"
cp "$CI_DIR/deploy-docs.sh" "$CI_DIR/tcab-lib.sh" "$repo/scripts/ci/"
for tool in npm npx; do
	cat >"$repo/bin/$tool" <<STUB
#!/usr/bin/env bash
echo "$tool \$* [cwd=\$PWD token=\${CLOUDFLARE_API_TOKEN:-} account=\${CLOUDFLARE_ACCOUNT_ID:-}]" >>"\$STUB_LOG"
STUB
	chmod +x "$repo/bin/$tool"
done

run() { # args...
	: >"$tmp/calls.log"
	(cd "$tmp" && STUB_LOG="$tmp/calls.log" PATH="$repo/bin:$PATH" \
		CLOUDFLARE_API_TOKEN="${TOKEN-token}" CLOUDFLARE_ACCOUNT_ID="${ACCOUNT-account}" \
		"$repo/scripts/ci/deploy-docs.sh" "$@" 2>&1)
}

out="$(run master)"
check_equal "master deploys" "0" "$?"
check_equal "installs, builds the docs by directory, and deploys the production project" \
	"npm ci [cwd=$repo token=token account=account]
npm run build -w apps/docs [cwd=$repo token=token account=account]
npx --yes wrangler@4.40.3 pages deploy apps/docs/dist --project-name=test-cabinet-docs --branch=master [cwd=$repo token=token account=account]" \
	"$(cat "$tmp/calls.log")"

out="$(run staging)"
check_equal "staging deploys" "0" "$?"
check_contains "to the staging project, as its branch" \
	"--project-name=test-cabinet-docs-staging --branch=staging" "$(cat "$tmp/calls.log")"

out="$(run nightly)"
check_equal "another branch is refused" "1" "$?"
check_contains "naming it" "'nightly' deploys no docs (expected master or staging)" "$out"
check_equal "and runs nothing" "" "$(cat "$tmp/calls.log")"

out="$(TOKEN="" run master)"
check_equal "no API token is refused" "1" "$?"
check_contains "naming it" "CLOUDFLARE_API_TOKEN must be set" "$out"
check_equal "before anything runs" "" "$(cat "$tmp/calls.log")"

out="$(ACCOUNT="" run master)"
check_equal "no account id is refused" "1" "$?"
check_contains "naming it" "CLOUDFLARE_ACCOUNT_ID must be set" "$out"

out="$(run)"
check_equal "no branch is a usage error" "1" "$?"
check_contains "which says how to call it" "usage: scripts/ci/deploy-docs.sh <branch>" "$out"

echo
echo "deploy-docs.test.sh: ${pass} passed, ${fail} failed"
[ "$fail" -eq 0 ]
