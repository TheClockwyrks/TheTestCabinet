#!/usr/bin/env bash
# Table test for bootstrap.sh. Run it directly:
# ./bootstrap.test.sh
#
# Each case builds a throwaway superrepo whose origin is a bare repository in
# a directory of bare repositories, so the relative submodule URL resolves to
# a sibling bare repository there and nothing reaches a real remote.
set -uo pipefail

SCRIPTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
pass=0
fail=0

ok() { pass=$((pass + 1)); printf '  ok   %s\n' "$1"; }
bad() {
	fail=$((fail + 1))
	printf 'FAIL  %s\n' "$1"
	shift
	printf '        %s\n' "$@"
}

check_passed() { # label status output
	if [ "$2" -eq 0 ]; then
		ok "$1"
	else
		bad "$1" "expected exit 0" "got exit $2: ${3:-<empty>}"
	fi
}

check_failed() { # label status
	if [ "$2" -ne 0 ]; then
		ok "$1"
	else
		bad "$1" "expected a non-zero exit" "got exit 0"
	fi
}

check_contains() { # label needle haystack
	if grep -qF -- "$2" <<<"$3"; then
		ok "$1"
	else
		bad "$1" "expected output containing: $2" "got: ${3:-<empty>}"
	fi
}

check_equals() { # label expected actual
	if [ "$2" = "$3" ]; then
		ok "$1"
	else
		bad "$1" "expected: $2" "got: $3"
	fi
}

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# A commit hook runs this under `git -c ...`, whose settings reach every git
# below through these and would override the identity the tests configure.
unset GIT_CONFIG_PARAMETERS GIT_CONFIG_COUNT
export GIT_AUTHOR_NAME=test GIT_AUTHOR_EMAIL=test@example.com
export GIT_COMMITTER_NAME=test GIT_COMMITTER_EMAIL=test@example.com

# A superrepo checkout with an origin, and a directory of bare repositories
# beside it that stands in for the project on the remote.
fresh_superrepo() { # name...
	local base
	base="$(mktemp -d "$tmp/caseXXXXXX")"
	mkdir -p "$base/remotes"
	git init -q --bare "$base/remotes/the-test-cabinet"
	git init -q -b master "$base/super"
	git -C "$base/super" remote add origin "$base/remotes/the-test-cabinet"
	printf '# super\n' >"$base/super/README.md"
	git -C "$base/super" add -A
	git -C "$base/super" commit -q -m "chore: scaffold"
	for name in "$@"; do
		git init -q --bare "$base/remotes/$name"
		mkdir -p "$base/super/$name"
		printf 'name = "%s"\nkind = "library"\n' "$name" >"$base/super/$name/.test-cabinet-repo.toml"
		printf '# %s\n' "$name" >"$base/super/$name/README.md"
	done
	printf '%s' "$base"
}

run_bootstrap() { # base name
	TCAB_SUPERREPO="$1/super" TCAB_REMOTE_BASE="$1/remotes" "$SCRIPTS_DIR/bootstrap.sh" "$2" 2>&1
}

# --- A rendered repository is committed, pushed and registered ---------------
base="$(fresh_superrepo contracts)"
out="$(run_bootstrap "$base" contracts)"
status=$?
check_passed "bootstrap succeeds on a rendered repository" "$status" "$out"
check_contains "it commits the scaffold" "committed the scaffold of contracts" "$out"
check_contains "it pushes master" "pushed contracts to" "$out"
check_contains "it adds the submodule" "added contracts as a submodule" "$out"
check_equals "the remote holds master" "master" "$(git -C "$base/remotes/contracts" symbolic-ref --short HEAD 2>/dev/null || git -C "$base/remotes/contracts" branch --format='%(refname:short)' | head -1)"
check_equals "the commit subject is the scaffold" "chore: scaffold the contracts repository" "$(git -C "$base/remotes/contracts" log -1 --format=%s master)"
check_equals "the submodule URL is relative" "../contracts" "$(git -C "$base/super" config -f .gitmodules --get submodule.contracts.url)"
check_equals "the submodule tracks master" "master" "$(git -C "$base/super" config -f .gitmodules --get submodule.contracts.branch)"
check_equals "the checkout's origin is the remote" "$base/remotes/contracts" "$(git -C "$base/super/contracts" remote get-url origin)"

# --- The superrepo's identity reaches the repository -----------------------
# The account carries an identity of its own, as a developer's does, and the
# superrepo's still wins.
base="$(fresh_superrepo contracts)"
git -C "$base/super" config user.name "Repo Author"
git -C "$base/super" config user.email "author@example.com"
account="$base/account.gitconfig"
git config -f "$account" user.name "Account Holder"
git config -f "$account" user.email "account@example.com"
out="$(env -u GIT_AUTHOR_NAME -u GIT_AUTHOR_EMAIL -u GIT_COMMITTER_NAME -u GIT_COMMITTER_EMAIL \
	GIT_CONFIG_GLOBAL="$account" TCAB_SUPERREPO="$base/super" TCAB_REMOTE_BASE="$base/remotes" "$SCRIPTS_DIR/bootstrap.sh" contracts 2>&1)"
status=$?
check_passed "bootstrap succeeds with a superrepo identity" "$status" "$out"
check_equals "the repository takes the superrepo's name" "Repo Author" "$(git -C "$base/super/contracts" config --get user.name)"
check_equals "the repository takes the superrepo's email" "author@example.com" "$(git -C "$base/super/contracts" config --get user.email)"
check_equals "the scaffold commit carries it" "Repo Author <author@example.com>" "$(git -C "$base/remotes/contracts" log -1 --format='%an <%ae>' master)"

# --- A second run changes nothing ----------------------------------------
out="$(run_bootstrap "$base" contracts)"
status=$?
check_passed "a second run succeeds" "$status" "$out"
check_contains "it skips the commit" "already has a commit" "$out"
check_contains "it skips the push" "already holds master" "$out"
check_contains "it skips the submodule" "already a submodule" "$out"
check_equals "the remote still has one commit" "1" "$(git -C "$base/remotes/contracts" rev-list --count master)"

# --- An application's first commit carries its lock file --------------------
if command -v cargo >/dev/null 2>&1; then
	base="$(fresh_superrepo platform)"
	printf 'name = "platform"\nkind = "application"\n' >"$base/super/platform/.test-cabinet-repo.toml"
	printf '[package]\nname = "platform"\nversion = "0.0.0"\nedition = "2024"\n' >"$base/super/platform/Cargo.toml"
	mkdir -p "$base/super/platform/src"
	printf 'fn main() {}\n' >"$base/super/platform/src/main.rs"
	out="$(run_bootstrap "$base" platform)"
	status=$?
	check_passed "bootstrap succeeds on an application" "$status" "$out"
	check_contains "it resolves the lock file" "resolved the lock file of platform" "$out"
	check_equals "the scaffold commit carries Cargo.lock" "Cargo.lock" "$(git -C "$base/remotes/platform" ls-tree --name-only master Cargo.lock)"
	out="$(run_bootstrap "$base" platform)"
	status=$?
	check_passed "a second run on the application succeeds" "$status" "$out"
else
	printf '  skip an application lock file (no cargo on this machine)\n'
fi

# --- A workspace's first commit carries its npm lock file -------------------
# npm is a stub that records its arguments and writes the lock, so nothing is
# resolved against a registry.
stubs="$tmp/stubs"
mkdir -p "$stubs"
cat >"$stubs/npm" <<'STUB'
#!/usr/bin/env bash
echo "$PWD $*" >>"$STUB_NPM_LOG"
printf '{"lockfileVersion": 3}\n' >package-lock.json
STUB
chmod +x "$stubs/npm"
base="$(fresh_superrepo contracts)"
printf '{"name": "contracts-repository", "workspaces": ["packages/*"]}\n' >"$base/super/contracts/package.json"
out="$(STUB_NPM_LOG="$tmp/npm.log" PATH="$stubs:$PATH" run_bootstrap "$base" contracts)"
status=$?
check_passed "bootstrap succeeds on a workspace" "$status" "$out"
check_contains "it writes the npm lock file" "wrote the npm lock file of contracts" "$out"
check_equals "npm only writes the lock" "$base/super/contracts install --package-lock-only --ignore-scripts --no-audit --no-fund --loglevel=error" "$(cat "$tmp/npm.log")"
check_equals "the scaffold commit carries package-lock.json" "package-lock.json" "$(git -C "$base/remotes/contracts" ls-tree --name-only master package-lock.json)"

: >"$tmp/npm.log"
base="$(fresh_superrepo contracts)"
printf '{"name": "contracts-repository", "workspaces": ["packages/*"]}\n' >"$base/super/contracts/package.json"
printf '{"lockfileVersion": 3, "kept": true}\n' >"$base/super/contracts/package-lock.json"
out="$(STUB_NPM_LOG="$tmp/npm.log" PATH="$stubs:$PATH" run_bootstrap "$base" contracts)"
check_passed "bootstrap succeeds on a workspace holding its lock" $? "$out"
check_equals "npm is not run" "" "$(cat "$tmp/npm.log")"
check_contains "the lock is kept" '"kept": true' "$(git -C "$base/remotes/contracts" show master:package-lock.json)"

base="$(fresh_superrepo contracts)"
printf '{"name": "contracts-repository"}\n' >"$base/super/contracts/package.json"
out="$(STUB_NPM_LOG="$tmp/npm.log" PATH="$stubs:$PATH" run_bootstrap "$base" contracts)"
check_passed "bootstrap succeeds on a manifest without a workspace" $? "$out"
check_equals "npm is not run for it" "" "$(cat "$tmp/npm.log")"

# --- The first commit carries the gate runner's uv lock ---------------------
# uv is a stub that records its arguments and writes the lock, so nothing is
# resolved against an index.
cat >"$stubs/uv" <<'STUB'
#!/usr/bin/env bash
echo "$PWD $*" >>"$STUB_UV_LOG"
printf 'version = 1\n' >ci/uv.lock
STUB
chmod +x "$stubs/uv"
: >"$tmp/uv.log"
base="$(fresh_superrepo contracts)"
mkdir -p "$base/super/contracts/ci"
printf '[project]\nname = "the-test-cabinet-ci"\n' >"$base/super/contracts/ci/pyproject.toml"
out="$(STUB_UV_LOG="$tmp/uv.log" PATH="$stubs:$PATH" run_bootstrap "$base" contracts)"
status=$?
check_passed "bootstrap succeeds on a repository with a ci project" "$status" "$out"
check_contains "it writes the uv lock file" "wrote the uv lock file of contracts" "$out"
check_equals "uv only locks the ci project" "$base/super/contracts lock --quiet --project ci" "$(cat "$tmp/uv.log")"
check_equals "the scaffold commit carries ci/uv.lock" "ci/uv.lock" "$(git -C "$base/remotes/contracts" ls-tree --name-only master ci/uv.lock)"

: >"$tmp/uv.log"
base="$(fresh_superrepo contracts)"
mkdir -p "$base/super/contracts/ci"
printf '[project]\nname = "the-test-cabinet-ci"\n' >"$base/super/contracts/ci/pyproject.toml"
printf 'version = 1\nkept = true\n' >"$base/super/contracts/ci/uv.lock"
out="$(STUB_UV_LOG="$tmp/uv.log" PATH="$stubs:$PATH" run_bootstrap "$base" contracts)"
check_passed "bootstrap succeeds on a ci project holding its lock" $? "$out"
check_equals "uv is not run" "" "$(cat "$tmp/uv.log")"
check_contains "the lock is kept" "kept = true" "$(git -C "$base/remotes/contracts" show master:ci/uv.lock)"

base="$(fresh_superrepo contracts)"
out="$(STUB_UV_LOG="$tmp/uv.log" PATH="$stubs:$PATH" run_bootstrap "$base" contracts)"
check_passed "bootstrap succeeds without a ci project" $? "$out"
check_equals "uv is not run for it" "" "$(cat "$tmp/uv.log")"

# --- A directory the kit did not render is refused ------------------------
base="$(fresh_superrepo)"
mkdir -p "$base/super/stray"
out="$(run_bootstrap "$base" stray)"
check_failed "an unrendered directory is refused" $?
check_contains "it names the missing record" "no .test-cabinet-repo.toml" "$out"

# --- A missing directory is refused ----------------------------------------
out="$(run_bootstrap "$base" absent)"
check_failed "a missing directory is refused" $?
check_contains "it says to render first" "render it first" "$out"

# --- A name with a slash is refused ----------------------------------------
out="$(run_bootstrap "$base" "a/b")"
check_failed "a path is refused as a name" $?

printf '\n%d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
