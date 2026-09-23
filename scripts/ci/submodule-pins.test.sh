#!/usr/bin/env bash
# Table test for submodule-pins.sh. Run it directly:
#
#   scripts/ci/submodule-pins.test.sh
#
# The resolver cases compare against the address `git submodule init` writes for
# the same superproject URL, so the script and git cannot disagree. The gate
# cases build a superproject and its submodule repositories as local
# directories, which needs no network and no credentials.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly HERE
readonly GATE="${HERE}/submodule-pins.sh"
pass=0
fail=0

scratch="$(mktemp -d)"
trap 'rm -rf "$scratch"' EXIT

export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
export GIT_AUTHOR_NAME=test GIT_AUTHOR_EMAIL=test@example.com
export GIT_COMMITTER_NAME=test GIT_COMMITTER_EMAIL=test@example.com

report() { # label ok(true|false) detail
	if [[ "$2" == true ]]; then
		pass=$((pass + 1))
		printf '  ok   %s\n' "$1"
	else
		fail=$((fail + 1))
		printf 'FAIL  %s: %s\n' "$1" "$3"
	fi
}

# What git itself resolves <url> to in a superproject whose origin is <base>.
git_resolves() {
	local repo="${scratch}/resolve"
	rm -rf "$repo"
	git init --quiet "$repo"
	git -C "$repo" remote add origin "$1"
	git -C "$repo" config -f .gitmodules submodule.sub.path sub
	git -C "$repo" config -f .gitmodules submodule.sub.url "$2"
	git -C "$repo" update-index --add --cacheinfo "160000,$(printf '%040d' 1),sub"
	git -C "$repo" submodule --quiet init
	git -C "$repo" config submodule.sub.url
}

echo "--- the resolver agrees with git ---"
resolves() { # base url expected
	local ours theirs
	ours="$("$GATE" --resolve "$1" "$2")"
	theirs="$(git_resolves "$1" "$2")"
	if [[ "$ours" == "$3" && "$theirs" == "$3" ]]; then
		report "$1 + $2" true
	else
		report "$1 + $2" false "expected $3, script gave $ours, git gave $theirs"
	fi
}
resolves git@ssh.dev.azure.com:v3/genyume/the-test-cabinet/the-test-cabinet ../cold-storage \
	git@ssh.dev.azure.com:v3/genyume/the-test-cabinet/cold-storage
resolves https://genyume@dev.azure.com/genyume/the-test-cabinet/_git/the-test-cabinet ../cold-storage \
	https://genyume@dev.azure.com/genyume/the-test-cabinet/_git/cold-storage
resolves https://github.com/TheClockwyrks/TheTestCabinet.git ../cold-storage \
	https://github.com/TheClockwyrks/cold-storage
resolves https://github.com/TheClockwyrks/TheTestCabinet/ ../test-suites \
	https://github.com/TheClockwyrks/test-suites
resolves git@github.com:TheClockwyrks/TheTestCabinet.git ../cold-storage \
	git@github.com:TheClockwyrks/cold-storage
resolves git@example.com:super ../sub git@example.com:sub
resolves https://example.com/a/super ./sub https://example.com/a/super/sub
resolves https://example.com/a/b/super ../../sub https://example.com/a/sub
resolves https://example.com/a/super https://example.org/elsewhere https://example.org/elsewhere

# A host holding a superproject and its submodule repositories side by side.
# The submodule `sub` has two commits on master and one on a side branch.
host="${scratch}/host"
mkdir -p "$host"
git init --quiet --initial-branch=master "${host}/sub"
git -C "${host}/sub" config uploadpack.allowFilter true
git -C "${host}/sub" commit --quiet --allow-empty -m first
old="$(git -C "${host}/sub" rev-parse HEAD)"
git -C "${host}/sub" commit --quiet --allow-empty -m second
tip="$(git -C "${host}/sub" rev-parse HEAD)"
git -C "${host}/sub" checkout --quiet -b side
git -C "${host}/sub" commit --quiet --allow-empty -m side
side="$(git -C "${host}/sub" rev-parse HEAD)"
git -C "${host}/sub" checkout --quiet master
missing="$(printf '%040d' 7)"

# A second host whose `sub` holds only the first commit, as a mirror that has
# not caught up would.
behind="${scratch}/behind"
mkdir -p "$behind"
git clone --quiet --bare --single-branch --branch master "${host}/sub" "${behind}/sub"
git -C "${behind}/sub" update-ref refs/heads/master "$old"
git -C "${behind}/sub" config uploadpack.allowFilter true

# super <gitmodules path=url...> -- <path=commit...>: a fresh superproject in
# $host carrying the gate, the given .gitmodules and the given gitlinks.
super() {
	local repo="${host}/super" entry
	rm -rf "$repo"
	git init --quiet "$repo"
	mkdir -p "${repo}/scripts/ci"
	cp "$GATE" "${HERE}/lib.sh" "${repo}/scripts/ci/"
	git -C "$repo" remote add origin "$repo"
	while [[ $# -gt 0 && "$1" != -- ]]; do
		entry="$1"
		git -C "$repo" config -f .gitmodules "submodule.${entry%%=*}.path" "${entry%%=*}"
		git -C "$repo" config -f .gitmodules "submodule.${entry%%=*}.url" "${entry#*=}"
		shift
	done
	shift
	# The gitlinks go straight into the index, because their paths hold no
	# checkout for `git add` to find.
	git -C "$repo" add -A
	for entry in "$@"; do
		git -C "$repo" update-index --add --cacheinfo "160000,${entry#*=},${entry%%=*}"
	done
	git -C "$repo" commit --quiet --allow-empty -m super
}

gate() { # label expected(pass|fail) [superproject-url]
	local out verdict
	if out="$("${host}/super/scripts/ci/submodule-pins.sh" "${@:3}" 2>&1)"; then
		verdict=pass
	else
		verdict=fail
	fi
	if [[ "$verdict" == "$2" ]]; then
		report "$1" true
	else
		report "$1" false "expected $2, got $verdict: $out"
	fi
}

echo "--- the gate ---"
super -- && gate "no submodules" pass
super sub=../sub -- "sub=${tip}" && gate "pin at the tip of master" pass
super sub=../sub -- "sub=${old}" && gate "pin behind the tip of master" pass
super sub=../sub -- "sub=${side}" && gate "pin on a side branch" fail
super sub=../sub -- "sub=${missing}" && gate "pin the submodule does not hold" fail
super -- "sub=${tip}" && gate "pin with no .gitmodules entry" fail
super sub=../absent -- "sub=${tip}" && gate "submodule repository missing" fail
super sub=../sub -- "sub=${tip}" && gate "the superproject URL argument decides the host" fail "${behind}/super"
super sub=../sub -- "sub=${old}" && gate "a host that holds the pin passes" pass "${behind}/super"
super sub="${host}/sub" -- "sub=${side}" && gate "absolute URLs are checked too" fail

echo
echo "${pass} passed, ${fail} failed"
[[ "$fail" -eq 0 ]]
