#!/usr/bin/env bash
# Table test for build-context.sh. Run it directly:
# scripts/ci/build-context.test.sh
#
# The script reads the whole tracked tree, so each case runs it in a throwaway
# git repository holding a copy of this checkout's tracked files (test-cases/
# and tasks/ aside, which no Dockerfile reads), then breaks one thing the case
# names. The pristine copy has to pass, which is the build-context gate itself;
# the subject of the rest is that each kind of break fails, naming the file to
# fix.
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

export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
export GIT_AUTHOR_NAME=test GIT_AUTHOR_EMAIL=test@example.com
export GIT_COMMITTER_NAME=test GIT_COMMITTER_EMAIL=test@example.com

SOURCE="$(cd "$CI_DIR/../.." && pwd)"
readonly SOURCE
# The paths under test-cases/ a Dockerfile copies, which the copy has to hold.
mapfile -t case_sources < <(cd "$SOURCE" && git ls-files -z -- '*Dockerfile' '*.Dockerfile' '*.dockerfile' |
	xargs -0 grep -hoE '^[[:space:]]*(COPY|ADD)[[:space:]].*' | grep -oE '(^|[[:space:]])test-cases/[^[:space:]]+' |
	sed 's/^[[:space:]]*//' | sort -u)
# One repository holding the tracked tree, indexed once; each case works in a copy of it by hard links.
base="$tmp/base"
mkdir -p "$base"
(cd "$SOURCE" && { git ls-files -z -- ':!test-cases' ':!tasks' && git ls-files -z -- "${case_sources[@]}"; } |
	tar --null -T - -cf -) | tar -C "$base" -xf -
git -C "$base" init --quiet
git -C "$base" add -A -f

fresh_repo() {
	local repo
	repo="$(mktemp -d "$tmp/repoXXXXXX")"
	cp -al "$base/." "$repo/"
	printf '%s' "$repo"
}
# Replaces a file's hard link with a copy of its own before a case edits it.
own() { cp --remove-destination "$1" "$1.own" && mv "$1.own" "$1"; }
run() { (cd "$tmp" && "$1/scripts/ci/build-context.sh" 2>&1); }

repo="$(fresh_repo)"
out="$(run "$repo")"
check_equal "the checkout's tree passes" "0" "$?"
check_contains "and reports what it checked" "Rust pin(s) under containers/ name rust-toolchain.toml's channel" "$out"

echo "--- an allowlist that drops a source a Dockerfile copies ---"
repo="$(fresh_repo)"
own "$repo/.dockerignore"
# Both entries admit it: the directory's own, and the file's.
sed -i -E '\#^!/scripts/ci(/install-java\.sh)?$#d' "$repo/.dockerignore"
out="$(run "$repo")"
check_equal "fails" "1" "$?"
check_contains "naming the source and the allowlist" "copies 'scripts/ci/install-java.sh', which .dockerignore keeps OUT of the build context." "$out"

echo "--- a Dockerfile that copies a path that does not exist ---"
repo="$(fresh_repo)"
dockerfile="containers/tools/Dockerfile"
own "$repo/$dockerfile"
printf '\nCOPY scripts/ci/no-such-helper.sh /tmp/\n' >>"$repo/$dockerfile"
out="$(run "$repo")"
check_equal "fails" "1" "$?"
check_contains "naming the Dockerfile and the source" "$dockerfile:" "$out"
check_contains "and that it is absent" "copies 'scripts/ci/no-such-helper.sh', which does not exist in the repository." "$out"

echo "--- a case image pinning another Rust ---"
repo="$(fresh_repo)"
own "$repo/containers/base-wasm/Dockerfile"
sed -i 's/^ARG RUST_VERSION=.*/ARG RUST_VERSION=1.0.0/' "$repo/containers/base-wasm/Dockerfile"
channel="$(sed -nE 's/^[[:space:]]*channel[[:space:]]*=[[:space:]]*"([^"]+)".*/\1/p' "$repo/rust-toolchain.toml")"
out="$(run "$repo")"
check_equal "fails" "1" "$?"
check_contains "naming the pin and the channel" "pins Rust 1.0.0, and rust-toolchain.toml's channel is $channel." "$out"

echo "--- a re-inclusion by wildcard ---"
repo="$(fresh_repo)"
own "$repo/.dockerignore"
printf '\n!/scripts/ci/install-*.sh\n' >>"$repo/.dockerignore"
out="$(run "$repo")"
check_equal "fails" "1" "$?"
check_contains "naming the pattern" "re-includes '!/scripts/ci/install-*.sh' with a wildcard, and a re-inclusion must name a path." "$out"

echo "--- an allowlist that admits a git-ignored path ---"
repo="$(fresh_repo)"
own "$repo/.dockerignore"
printf '\n!/scratch.log\n' >>"$repo/.dockerignore"
own "$repo/.git/info/exclude"
printf 'scratch.log\n' >>"$repo/.git/info/exclude"
printf 'x' >"$repo/scratch.log"
out="$(run "$repo")"
check_equal "fails" "1" "$?"
check_contains "naming the path" ".dockerignore lets 'scratch.log' into the build context, and git ignores it." "$out"

echo
echo "build-context.test.sh: ${pass} passed, ${fail} failed"
[ "$fail" -eq 0 ]
