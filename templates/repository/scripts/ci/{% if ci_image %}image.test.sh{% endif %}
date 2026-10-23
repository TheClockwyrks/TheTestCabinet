#!/usr/bin/env bash
# Table test for image.sh. Run it directly: scripts/ci/image.test.sh
#
# A copy of the script runs in a throwaway repository with `docker` and
# `uname` stubbed first on PATH; the docker stub records its arguments and
# fails whichever call the case says. Nothing reaches a daemon or a registry.
# The subject is the tag, the cache and the secret each build is given.
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

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# In the kit the script carries a conditional name; in a render it is itself.
source_script="$CI_DIR/image.sh"
[ -f "$source_script" ] || source_script="$CI_DIR/{% if ci_image %}image.sh{% endif %}"

readonly SHA="0123456789abcdef0123456789abcdef01234567"
readonly R="testcabinet.azurecr.io"
repo="$tmp/repo"
mkdir -p "$repo/scripts/ci" "$tmp/bin" "$tmp/home" "$tmp/elsewhere"
cp "$source_script" "$repo/scripts/ci/image.sh"
printf 'FROM scratch\n' >"$repo/Dockerfile"
printf '[url "https://dev.azure.com/x"]\n' >"$tmp/home/.gitconfig"
printf '//feed.invalid/:_authToken=x\n' >"$tmp/home/.npmrc"
cat >"$tmp/bin/docker" <<'STUB'
#!/usr/bin/env bash
echo "docker $* (in $PWD)" >>"$STUB_LOG"
n="$(grep -c . "$STUB_LOG")"
code="STUB_DOCKER_EXIT_$n"
exit "${!code:-0}"
STUB
cat >"$tmp/bin/uname" <<'STUB'
#!/usr/bin/env bash
echo "${STUB_MACHINE:-x86_64}"
STUB
chmod +x "$tmp/bin/docker" "$tmp/bin/uname"
run() {
	: >"$tmp/docker.log"
	# NPM_CONFIG_USERCONFIG is the case's alone, never the caller's environment's.
	(cd "$tmp/elsewhere" && HOME="$tmp/home" STUB_LOG="$tmp/docker.log" PATH="$tmp/bin:$PATH" \
		NPM_CONFIG_USERCONFIG="${CASE_NPM_USERCONFIG:-}" \
		"$repo/scripts/ci/image.sh" "$@" 2>&1)
}

echo "--- an amd64 build ---"
out="$(run microservice-one "$SHA")"
check_equal "passes" "0" "$?"
log="$(cat "$tmp/docker.log")"
build="$(grep 'buildx build' <<<"$log")"
check_contains "uses a builder of its own" "docker buildx create --name repository-image --driver docker-container --use" "$log"
check_contains "builds the root Dockerfile from the repository root" "--file Dockerfile" "$build"
check_contains "with the root as the context" ". (in $repo)" "$build"
check_contains "for the agent's architecture" "--platform linux/amd64" "$build"
check_contains "tagged with the commit and the architecture" "--tag $R/microservice-one:$SHA-amd64" "$build"
check_contains "stamped with the commit" "--build-arg TCAB_BUILD_COMMIT=$SHA" "$build"
check_contains "cached in the registry per architecture" "--cache-to type=registry,ref=$R/microservice-one:buildcache-amd64,mode=max" "$build"
check_contains "and read back from there" "--cache-from type=registry,ref=$R/microservice-one:buildcache-amd64" "$build"
check_contains "handed the git configuration as a secret" "--secret id=gitconfig,src=$tmp/home/.gitconfig" "$build"
check_contains "and the npm configuration as another" "--secret id=npmrc,src=$tmp/home/.npmrc" "$build"
check_contains "and pushed" "--push" "$build"

echo "--- an arm64 build ---"
STUB_MACHINE=aarch64 run microservice-one "$SHA" >/dev/null
build="$(grep 'buildx build' "$tmp/docker.log")"
check_contains "is tagged arm64" "--tag $R/microservice-one:$SHA-arm64" "$build"
check_contains "for linux/arm64" "--platform linux/arm64" "$build"

echo "--- no git configuration ---"
out="$(IMAGE_GIT_CONFIG="$tmp/none" run microservice-one "$SHA")"
check_equal "still builds" "0" "$?"
check_lacks "handing no git secret" "id=gitconfig" "$(cat "$tmp/docker.log")"
check_contains "and says so" "fetches from the public sources" "$out"

echo "--- no npm configuration ---"
out="$(IMAGE_NPM_CONFIG="$tmp/none" run microservice-one "$SHA")"
check_equal "still builds" "0" "$?"
build="$(grep 'buildx build' "$tmp/docker.log")"
check_lacks "handing no npm secret" "id=npmrc" "$build"
check_contains "but still the git one" "--secret id=gitconfig" "$build"
check_contains "and says so" "holds no credential for the feed" "$out"

echo "--- the npm configuration npm names ---"
printf '//feed.invalid/:_authToken=y\n' >"$tmp/elsewhere.npmrc"
CASE_NPM_USERCONFIG="$tmp/elsewhere.npmrc" run microservice-one "$SHA" >/dev/null
check_contains "is the one handed" "--secret id=npmrc,src=$tmp/elsewhere.npmrc" "$(cat "$tmp/docker.log")"

echo "--- another registry ---"
IMAGE_REGISTRY=example.invalid run microservice-one "$SHA" >/dev/null
check_contains "is the one the tag names" "--tag example.invalid/microservice-one:$SHA-amd64" "$(cat "$tmp/docker.log")"

echo "--- a failed build ---"
STUB_DOCKER_EXIT_2=1 run microservice-one "$SHA" >/dev/null
check_equal "fails the step" "1" "$?"

echo "--- refusals ---"
out="$(run microservice-one)"
check_equal "a missing commit is a usage error" "1" "$?"
check_contains "which says how to call it" "usage: scripts/ci/image.sh <image> <sha>" "$out"
out="$(run microservice-one abc123)"
check_equal "a short commit is refused" "1" "$?"
check_contains "naming it" "'abc123' is not a full commit hash" "$out"
out="$(STUB_MACHINE=riscv64 run microservice-one "$SHA")"
check_equal "an unknown architecture is refused" "1" "$?"
rm "$repo/Dockerfile"
out="$(run microservice-one "$SHA")"
check_equal "a repository without a Dockerfile is refused" "1" "$?"
check_contains "saying so" "no Dockerfile at the repository root" "$out"
check_equal "and nothing is built" "" "$(cat "$tmp/docker.log")"

echo
echo "image.test.sh: ${pass} passed, ${fail} failed"
[ "$fail" -eq 0 ]
