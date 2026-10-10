#!/usr/bin/env bash
# Table test for submodules.sh, and for build-context.sh's `--submodules`, which
# it reads. Run it directly:
#
#   scripts/ci/submodules.test.sh
#
# The cases build a superproject and its submodule repositories as local
# directories, which needs no network and no credentials. The last case runs
# `check` against this repository, so a submodule added to .gitmodules and not
# to the `submodule_pins` job's list (or the other way round) fails here.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly HERE
pass=0
fail=0

scratch="$(mktemp -d)"
trap 'rm -rf "$scratch"' EXIT

export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
export GIT_AUTHOR_NAME=test GIT_AUTHOR_EMAIL=test@example.com
export GIT_COMMITTER_NAME=test GIT_COMMITTER_EMAIL=test@example.com
# Submodules from local paths, which git refuses by default.
export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=protocol.file.allow GIT_CONFIG_VALUE_0=always
unset SYSTEM_ACCESSTOKEN

report() { # label ok(true|false) detail
	if [[ "$2" == true ]]; then
		pass=$((pass + 1))
		printf '  ok   %s\n' "$1"
	else
		fail=$((fail + 1))
		printf 'FAIL  %s: %s\n' "$1" "$3"
	fi
}

expect() { # label expected(pass|fail) command...
	local out verdict
	if out="$("${@:3}" 2>&1)"; then verdict=pass; else verdict=fail; fi
	if [[ "$verdict" == "$2" ]]; then
		report "$1" true
	else
		report "$1" false "expected $2, got $verdict: $out"
	fi
	LAST="$out"
}

check_equal() { # label expected actual
	if [[ "$2" == "$3" ]]; then
		report "$1" true
	else
		report "$1" false "expected '$2', got '$3'"
	fi
}

# Three submodule repositories side by side. `contracts` has a submodule of its
# own, `nested`, so a recursive init would be seen.
host="${scratch}/host"
mkdir -p "$host"
for repo in nested contracts media; do
	git init --quiet --initial-branch=master "${host}/${repo}"
	mkdir -p "${host}/${repo}/crates"
	echo "$repo" >"${host}/${repo}/crates/lib.rs"
	git -C "${host}/${repo}" add -A
	git -C "${host}/${repo}" commit --quiet -m "$repo"
done
git -C "${host}/contracts" submodule --quiet add ../nested nested
git -C "${host}/contracts" commit --quiet -m "pin nested"

# super <dockerignore-lines>: a fresh superproject in $host pinning contracts
# and media, carrying the two scripts and the given root .dockerignore.
super() {
	local repo="${host}/super"
	rm -rf "$repo"
	git init --quiet --initial-branch=master "$repo"
	git -C "$repo" remote add origin "$repo"
	mkdir -p "${repo}/scripts/ci" "${repo}/.azure/project"
	cp "${HERE}/submodules.sh" "${HERE}/build-context.sh" "${HERE}/tcab-lib.sh" "${repo}/scripts/ci/"
	printf '%s\n' '*' "$@" >"${repo}/.dockerignore"
	git -C "$repo" submodule --quiet add ../contracts contracts
	git -C "$repo" submodule --quiet add ../media media
	git -C "$repo" add -A
	git -C "$repo" commit --quiet -m super
	# A fresh checkout's state: declared and pinned, not initialized.
	git -C "$repo" submodule --quiet deinit --all --force
	rm -rf "${repo}/.git/modules"
}
helper() { "${host}/super/scripts/ci/submodules.sh" "$@"; }
initialized() { # path
	[[ -e "${host}/super/$1/.git" ]]
}

echo "--- what the build context admits ---"
super
check_equal "an allowlist naming no submodule admits none" "" \
	"$("${host}/super/scripts/ci/build-context.sh" --submodules)"
super '!/contracts/crates'
check_equal "a path inside a submodule admits it" "contracts" \
	"$("${host}/super/scripts/ci/build-context.sh" --submodules)"
super '!/media'
check_equal "the submodule itself admits it" "media" \
	"$("${host}/super/scripts/ci/build-context.sh" --submodules)"
super '!/contracts/crates' '!/media/crates/lib.rs'
check_equal "both, in .gitmodules order" "contracts media" \
	"$("${host}/super/scripts/ci/build-context.sh" --submodules | paste -sd' ' -)"
super '!/contracts-old'
check_equal "a sibling sharing a prefix admits nothing" "" \
	"$("${host}/super/scripts/ci/build-context.sh" --submodules)"

echo "--- list ---"
super '!/contracts/crates'
expect "nothing named lists nothing" pass helper list
check_equal "and prints nothing" "" "$LAST"
expect "--build-context lists the admitted submodule" pass helper list --build-context
check_equal "and only it" "contracts" "$LAST"
expect "a named path is listed once" pass helper list media media/ --build-context media
check_equal "in the order given" "media contracts" "$(paste -sd' ' - <<<"$LAST")"
expect "an undeclared path is refused" fail helper list nope
expect "--recursive is refused" fail helper list --recursive media

echo "--- init ---"
super '!/contracts/crates'
expect "nothing to initialize succeeds" pass helper init
report "and initializes nothing" "$(initialized contracts || initialized media && echo false || echo true)" \
	"a submodule was initialized"
expect "a named submodule is initialized" pass helper init media
report "media is checked out" "$(initialized media && echo true || echo false)" "media/.git missing"
report "contracts is not" "$(initialized contracts && echo false || echo true)" "contracts was initialized"
check_equal "at the pinned commit" "$(git -C "${host}/super" ls-tree HEAD media | awk '{ print $3 }')" \
	"$(git -C "${host}/super/media" rev-parse HEAD)"
super '!/contracts/crates'
expect "--build-context initializes the admitted submodule" pass helper init --build-context
report "contracts is checked out" "$(initialized contracts && echo true || echo false)" "contracts/.git missing"
report "media is not" "$(initialized media && echo false || echo true)" "media was initialized"
report "its own submodule is not" \
	"$([[ -e "${host}/super/contracts/nested/.git" ]] && echo false || echo true)" "nested was initialized"
expect "an undeclared path initializes nothing" fail helper init media nope
report "media is still not" "$(initialized media && echo false || echo true)" "media was initialized"

echo "--- check ---"
jobs() { # yaml-lines...: the superproject's .azure/project/jobs.yml
	printf '%s\n' "parameters:" "  - name: rustImage" "    type: string" "$@" "" "jobs:" "  - job: x" \
		>"${host}/super/.azure/project/jobs.yml"
}
super
jobs "  - name: submodules" "    type: object" "    default:" \
	"      - path: contracts" "        repository: contracts" \
	"      - path: media" "        repository: media"
expect "every submodule listed passes" pass helper check
jobs "  - name: submodules" "    type: object" "    default:" \
	"      - path: contracts" "        repository: contracts"
expect "a submodule missing from the list fails" fail helper check
jobs "  - name: submodules" "    type: object" "    default:" \
	"      - path: contracts" "        repository: contracts" \
	"      - path: media" "        repository: media" \
	"      - path: gone" "        repository: gone"
expect "an entry .gitmodules lacks fails" fail helper check
jobs "  - name: submodules" "    type: object" "    default:" \
	"      - path: contracts" "        repository: contracts" \
	"      - path: media" "        repository: cold-storage"
expect "the wrong repository fails" fail helper check
jobs "  - name: other" "    type: object" "    default:" \
	"      - path: contracts" "        repository: contracts" \
	"      - path: media" "        repository: media"
expect "another parameter's list does not count" fail helper check
rm "${host}/super/.azure/project/jobs.yml"
expect "no jobs file fails" fail helper check

echo "--- this repository ---"
expect "the submodule_pins job checks out every submodule" pass "${HERE}/submodules.sh" check

echo
echo "${pass} passed, ${fail} failed"
[[ "$fail" -eq 0 ]]
