#!/usr/bin/env bash
# Table test for publish-packages.sh. Run it directly: ./publish-packages.test.sh
#
# Each case copies the script into a repository of its own, under
# scripts/ci/, beside a stub of npm-feed.sh that records the registry it was
# asked to authenticate to and whether it was handed the token. The script
# runs with a PATH holding nothing but stubs: `npm` answers `pkg get` with the
# case's manifests, answers `view` for the versions the case says the feed
# holds, and records every other command, and `node` is the real one. So the
# log is every step the script took, in order, and a command the script calls
# without a stub here fails the case.
set -uo pipefail

CI_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$CI_DIR/publish-packages.sh"
REGISTRY="https://pkgs.example.invalid/org/project/_packaging/feed/npm/registry/"
TOKEN="tok-5ecret-123"
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
		bad "$1" "expected no: $2" "got: $3"
	else
		ok "$1"
	fi
}

node="$(command -v node)"
if [ -z "$node" ]; then
	echo "publish-packages.test: node is required; the devcontainer and the web CI image carry it" >&2
	exit 1
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

stubs="$tmp/bin"
mkdir -p "$stubs"
cat >"$stubs/npm" <<'STUB'
#!/bin/sh
printf 'npm %s (in %s)\n' "$*" "${PWD##*/}" >>"$STUB_LOG"
case "$*" in
"pkg get name version private publishConfig --workspaces --json")
	printf '%s\n' "$STUB_PACKAGES"
	exit "${STUB_PKG_STATUS:-0}"
	;;
"ci --no-audit --no-fund" | "run build")
	[ "$*" = "${STUB_FAIL:-}" ] && exit 1
	exit 0
	;;
view\ *)
	# view <name>@<version> version --registry <registry>
	for held in ${STUB_HELD:-}; do
		if [ "$held" = "$2" ]; then
			printf '%s\n' "${2##*@}"
			exit 0
		fi
	done
	echo "npm error 404 Not Found - $2" >&2
	exit 1
	;;
publish\ *)
	[ "$3" = "${STUB_FAIL:-}" ] && exit 1
	exit 0
	;;
esac
echo "npm stub: unexpected arguments: $*" >&2
exit 2
STUB
printf '#!/bin/sh\nexec %s "$@"\n' "$node" >"$stubs/node"
chmod +x "$stubs"/*
export STUB_LOG="$tmp/stub.log"

# A repository holding the script, the stub of the feed's credential step and
# the typescript gate, whose presence is all the script reads of it.
repo="$tmp/repo"
mkdir -p "$repo/scripts/ci" "$repo/typescript" "$repo/ci/gates"
: >"$repo/ci/gates/typescript.py"
cp "$SCRIPT" "$repo/scripts/ci/publish-packages.sh"
cat >"$repo/scripts/ci/npm-feed.sh" <<'STUB'
#!/bin/sh
if [ "${SYSTEM_ACCESSTOKEN:-}" = "$STUB_TOKEN" ]; then given=given; else given=missing; fi
printf 'npm-feed %s (token %s)\n' "$*" "$given" >>"$STUB_LOG"
exit "${STUB_FEED_STATUS:-0}"
STUB
chmod +x "$repo/scripts/ci/"*.sh
echo '{"name": "packages", "private": true, "workspaces": ["packages/*"]}' >"$repo/typescript/package.json"

run() { # env-assignment... -- argument...
	local assignments=()
	while [ "$#" -gt 0 ] && [ "$1" != "--" ]; do
		assignments+=("$1")
		shift
	done
	shift
	: >"$STUB_LOG"
	(
		cd "$tmp" || exit 1
		env -i PATH="$stubs" HOME="$tmp/home" STUB_LOG="$STUB_LOG" STUB_TOKEN="$TOKEN" \
			SYSTEM_ACCESSTOKEN="$TOKEN" "${assignments[@]}" \
			"$BASH" "$repo/scripts/ci/publish-packages.sh" "$@" 2>&1
	)
}

manifest() { # name version [extra JSON fields]
	# A manifest names the feed under publishConfig unless the extra fields
	# name a publishConfig of their own.
	local extra="${3:-}"
	case "$extra" in
	*publishConfig*) ;;
	*) extra="${extra:+$extra, }\"publishConfig\": {\"registry\": \"$REGISTRY\"}" ;;
	esac
	printf '"%s": {"name": "%s", "version": "%s", %s}' "$1" "$1" "$2" "$extra"
}

MODEL="$(manifest @v/model 1.2.0)"
VIEWS="$(manifest @v/views 1.2.0 '"publishConfig": {"registry": "'"$REGISTRY"'"}')"
INTERNAL="$(manifest @v/internal 0.0.0 '"private": true')"
MIXED="{$MODEL, $INTERNAL, $VIEWS}"

echo "--- each public package is published once, at the tag's version ---"

out="$(run STUB_PACKAGES="$MIXED" -- typescript "$REGISTRY" refs/tags/v1.2.0)"
status=$?
log="$(cat "$STUB_LOG")"
check_equal "exits 0" 0 "$status"
check_equal "authenticates, installs, builds, then publishes each public package" \
	"$(
		cat <<LOG
npm pkg get name version private publishConfig --workspaces --json (in typescript)
npm-feed $REGISTRY (token given)
npm ci --no-audit --no-fund (in typescript)
npm run build (in typescript)
npm view @v/model@1.2.0 version --registry $REGISTRY (in typescript)
npm publish --workspace @v/model --registry $REGISTRY (in typescript)
npm view @v/views@1.2.0 version --registry $REGISTRY (in typescript)
npm publish --workspace @v/views --registry $REGISTRY (in typescript)
LOG
	)" "$log"
check_lacks "publishes no private package" "publish --workspace @v/internal" "$log"
check_contains "says the private package is kept back" "@v/internal is private and is not published" "$out"
check_contains "names what it published" "published @v/model@1.2.0 to $REGISTRY" "$out"
check_lacks "prints no token" "$TOKEN" "$out"

echo "--- a tag named without its ref, and a registry without its final slash ---"

out="$(run STUB_PACKAGES="{$MODEL}" -- typescript "${REGISTRY%/}" v1.2.0)"
check_equal "exits 0" 0 "$?"
check_contains "publishes to the registry keyed with its slash" \
	"npm publish --workspace @v/model --registry $REGISTRY" "$(cat "$STUB_LOG")"

echo "--- a manifest whose private field is false is public ---"

out="$(run STUB_PACKAGES="{$(manifest @v/open 1.2.0 '"private": false')}" -- typescript "$REGISTRY" refs/tags/v1.2.0)"
check_equal "exits 0" 0 "$?"
check_contains "publishes it" "npm publish --workspace @v/open" "$(cat "$STUB_LOG")"

echo "--- a package the feed already holds at the version is left as it is ---"

out="$(run STUB_PACKAGES="$MIXED" STUB_HELD="@v/model@1.2.0" -- typescript "$REGISTRY" refs/tags/v1.2.0)"
status=$?
log="$(cat "$STUB_LOG")"
check_equal "exits 0" 0 "$status"
check_lacks "does not publish it again" "publish --workspace @v/model" "$log"
check_contains "publishes the one the feed lacks" "publish --workspace @v/views" "$log"
check_contains "says why" "@v/model@1.2.0 is already in the feed" "$out"

echo "--- a version off the tag is refused before anything is published ---"

STALE="{$(manifest @v/model 1.1.0), $INTERNAL, $(manifest @v/views 1.2.0)}"
out="$(run STUB_PACKAGES="$STALE" -- typescript "$REGISTRY" refs/tags/v1.2.0)"
status=$?
log="$(cat "$STUB_LOG")"
check_equal "exits 1" 1 "$status"
check_contains "names the package and both versions" "@v/model is at 1.1.0, and the tag v1.2.0 names 1.2.0" "$out"
check_lacks "names no package whose version is the tag's" "@v/views is at" "$out"
check_lacks "names no private package" "@v/internal is at" "$out"
check_equal "reads the manifests and does nothing more" \
	"npm pkg get name version private publishConfig --workspaces --json (in typescript)" "$log"

TWO_STALE="{$(manifest @v/model 1.1.0), $(manifest @v/views '')}"
out="$(run STUB_PACKAGES="$TWO_STALE" -- typescript "$REGISTRY" refs/tags/v1.2.0)"
check_equal "several off the tag: exits 1" 1 "$?"
check_contains "several off the tag: names the first" "@v/model is at 1.1.0" "$out"
check_contains "several off the tag: names the second" "@v/views is at no version" "$out"

echo "--- a package naming another registry, or none, is refused before anything is published ---"

registries=(
	# label | manifests npm answers | expected message
	"another registry|{$(manifest @v/model 1.2.0 '"publishConfig": {"registry": "https://registry.npmjs.org/"}')}|@v/model names https://registry.npmjs.org/ under publishConfig, not the feed"
	"no publishConfig|{\"@v/model\": {\"name\": \"@v/model\", \"version\": \"1.2.0\"}}|@v/model names no registry under publishConfig"
	"a publishConfig naming no registry|{$(manifest @v/model 1.2.0 '"publishConfig": {"access": "restricted"}')}|@v/model names no registry under publishConfig"
	"one of two public packages naming none|{$(manifest @v/model 1.2.0 '"publishConfig": {}'), $VIEWS}|@v/model names no registry under publishConfig"
)
for row in "${registries[@]}"; do
	IFS='|' read -r label packages message <<<"$row"
	out="$(run STUB_PACKAGES="$packages" -- typescript "$REGISTRY" refs/tags/v1.2.0)"
	status=$?
	check_equal "$label: exits 1" 1 "$status"
	check_contains "$label: names the package" "$message" "$out"
	check_contains "$label: says how to fix it" "\"publishConfig\": {\"registry\": \"$REGISTRY\"}" "$out"
	check_lacks "$label: names no package that names the feed" "@v/views names" "$out"
	check_equal "$label: reads the manifests and does nothing more" \
		"npm pkg get name version private publishConfig --workspaces --json (in typescript)" "$(cat "$STUB_LOG")"
done

out="$(run STUB_PACKAGES="{$(manifest @v/internal 0.0.0 '"private": true, "publishConfig": {}')}" -- typescript "$REGISTRY" refs/tags/v1.2.0)"
check_equal "a private package naming no registry: exits 0" 0 "$?"
check_contains "a private package naming no registry: is kept back" "@v/internal is private and is not published" "$out"

echo "--- a workspace with no public package skips with a notice ---"

skips=(
	# label | manifests npm answers | npm's exit status
	"only private packages|{$INTERNAL}|0"
	"no package at all|{\"error\": {\"summary\": \"No workspaces found!\", \"detail\": \"\"}}|1"
)
for row in "${skips[@]}"; do
	IFS='|' read -r label packages pkg_status <<<"$row"
	out="$(run STUB_PACKAGES="$packages" STUB_PKG_STATUS="$pkg_status" -- typescript "$REGISTRY" refs/tags/v1.2.0)"
	status=$?
	check_equal "$label: exits 0" 0 "$status"
	check_contains "$label: says why" "skipped: typescript/ holds no public package" "$out"
	check_equal "$label: reads the manifests and does nothing more" \
		"npm pkg get name version private publishConfig --workspaces --json (in typescript)" "$(cat "$STUB_LOG")"
done

echo "--- a repository with no workspace skips with a notice ---"

out="$(run -- elsewhere "$REGISTRY" refs/tags/v1.2.0)"
check_equal "exits 0" 0 "$?"
check_contains "says why" "skipped: elsewhere/package.json does not exist" "$out"
check_equal "runs nothing" "" "$(cat "$STUB_LOG")"

echo "--- a workspace no typescript gate builds is refused ---"

mv "$repo/ci/gates/typescript.py" "$tmp/typescript.py"
out="$(run -- elsewhere "$REGISTRY" refs/tags/v1.2.0)"
check_equal "without a workspace either: exits 0" 0 "$?"
check_contains "without a workspace either: says why" "skipped: elsewhere/package.json does not exist" "$out"
out="$(run STUB_PACKAGES="{$MODEL}" -- typescript "$REGISTRY" refs/tags/v1.2.0)"
check_equal "exits 1" 1 "$?"
check_contains "says why" "typescript/ is not built by a typescript gate" "$out"
check_equal "runs nothing" "" "$(cat "$STUB_LOG")"
mv "$tmp/typescript.py" "$repo/ci/gates/typescript.py"

echo "--- the failures ---"

cases=(
	# label | environment (space-separated) | arguments (space-separated) | expected message | last step run
	"a missing workspace|||the directory of the npm workspace is the first argument|"
	"a missing registry||typescript|the url of the npm registry of the feed is the second argument|"
	"a missing tag||typescript $REGISTRY|the tag the run is for is the third argument|"
	"a registry over http||typescript http://pkgs.example.invalid/npm/registry/ refs/tags/v1.2.0|the registry must be an https url|"
	"a branch rather than a tag||typescript $REGISTRY refs/heads/master|refs/heads/master is not a version tag|"
	"a tag that is not a version||typescript $REGISTRY refs/tags/nightly|refs/tags/nightly is not a version tag|"
	"a bare v||typescript $REGISTRY refs/tags/v|refs/tags/v is not a version tag|"
	"npm failing to list the packages|STUB_PKG_STATUS=1|typescript $REGISTRY refs/tags/v1.2.0|the packages of typescript/ could not be listed|pkg get"
	"npm listing an error|STUB_PACKAGES={\"error\":{\"summary\":\"broken\"}} STUB_PKG_STATUS=1|typescript $REGISTRY refs/tags/v1.2.0|broken|pkg get"
	"the credential step failing|STUB_FEED_STATUS=1|typescript $REGISTRY refs/tags/v1.2.0||npm-feed"
	"the install failing|STUB_FAIL=ci~--no-audit~--no-fund|typescript $REGISTRY refs/tags/v1.2.0||npm ci"
	"the build failing|STUB_FAIL=run~build|typescript $REGISTRY refs/tags/v1.2.0||npm run build"
	"a publish failing|STUB_FAIL=@v/model|typescript $REGISTRY refs/tags/v1.2.0||npm publish --workspace @v/model"
)
for row in "${cases[@]}"; do
	IFS='|' read -r label environment arguments message last <<<"$row"
	read -r -a assignments <<<"$environment"
	read -r -a args <<<"$arguments"
	# A space cannot be spelled inside the table's space-separated fields, so
	# the table writes it as a tilde.
	assignments=("${assignments[@]//\~/ }")
	has_packages=0
	for assignment in "${assignments[@]}"; do
		case "$assignment" in STUB_PACKAGES=*) has_packages=1 ;; esac
	done
	[ "$has_packages" -eq 1 ] || assignments+=("STUB_PACKAGES={$MODEL, $VIEWS}")
	out="$(run "${assignments[@]}" -- "${args[@]}")"
	status=$?
	log="$(cat "$STUB_LOG")"
	check_equal "$label: exits non-zero" 1 "$((status != 0))"
	[ -z "$message" ] || check_contains "$label: says why" "$message" "$out"
	if [ -z "$last" ]; then
		check_equal "$label: runs nothing" "" "$log"
	else
		check_contains "$label: stops at the step that failed" "$last" "$(tail -n 1 <<<"$log")"
	fi
	check_lacks "$label: says it published nothing" "published" "$out"
done

printf '\n%d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
