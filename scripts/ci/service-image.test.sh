#!/usr/bin/env bash
# Table test for service-image.sh. Run it directly:
# scripts/ci/service-image.test.sh
#
# A copy of the script runs in a throwaway repository with `docker` and `uname`
# stubbed first on PATH; the docker stub records each invocation and builds
# nothing. The subject is the image, Dockerfile, target, tag, cache and build
# arguments each service is built with, per architecture.
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

readonly SHA="0123456789abcdef0123456789abcdef01234567"
readonly R="testcabinet.azurecr.io"
repo="$tmp/repo"
mkdir -p "$repo/scripts/ci" "$repo/bin"
cp "$CI_DIR/service-image.sh" "$CI_DIR/tcab-lib.sh" "$repo/scripts/ci/"
cat >"$repo/bin/docker" <<'STUB'
#!/usr/bin/env bash
echo "docker $* [cwd=$PWD]" >>"$STUB_LOG"
[[ "$*" == "buildx create "* ]] && exit "${STUB_CREATE_EXIT:-0}"
exit 0
STUB
cat >"$repo/bin/uname" <<'STUB'
#!/usr/bin/env bash
echo "${STUB_UNAME_M:-x86_64}"
STUB
chmod +x "$repo/bin/docker" "$repo/bin/uname"
run() {
	: >"$tmp/docker.log"
	(cd "$tmp" && STUB_LOG="$tmp/docker.log" PATH="$repo/bin:$PATH" "$repo/scripts/ci/service-image.sh" "$@" 2>&1)
}
build_line() { grep '^docker buildx build ' "$tmp/docker.log"; }

# The build line a service is expected to produce: image, dockerfile, arch, extra arguments.
expected() { # image dockerfile arch extra
	echo "docker buildx build --platform linux/$3 --file $2 --tag $R/$1:$SHA-$3 --build-arg TCAB_BUILD_COMMIT=$SHA --provenance=false --cache-from type=registry,ref=$R/$1:buildcache-$3 --cache-to type=registry,ref=$R/$1:buildcache-$3,mode=max,image-manifest=true,oci-mediatypes=true --push${4:+ $4} . [cwd=$repo]"
}

for service in backend dispatcher artifacts arena publisher; do
	out="$(run "$service" "$SHA")"
	check_equal "$service builds" "0" "$?"
	check_equal "$service is tcab-$service, its target of services.Dockerfile" \
		"$(expected "tcab-$service" deployments/images/services.Dockerfile amd64 "--target $service")" "$(build_line)"
done

out="$(run auth "$SHA")"
check_equal "auth builds" "0" "$?"
check_equal "auth is tcab-auth-service" \
	"$(expected tcab-auth-service deployments/images/services.Dockerfile amd64 "--target auth")" "$(build_line)"

out="$(run driver "$SHA")"
check_equal "driver builds" "0" "$?"
check_equal "driver bakes the audio store of the same commit" \
	"$(expected tcab-driver deployments/images/services.Dockerfile amd64 "--target driver --build-arg AUDIO_STORE_IMAGE=$R/test-cabinet-audio-store:$SHA")" \
	"$(build_line)"

out="$(run web "$SHA")"
check_equal "web builds" "0" "$?"
check_equal "web has its own Dockerfile and no target" \
	"$(expected tcab-web deployments/images/web.Dockerfile amd64 "")" "$(build_line)"

out="$(STUB_UNAME_M=aarch64 run backend "$SHA")"
check_equal "an arm64 build succeeds" "0" "$?"
check_equal "is tagged, cached and platformed arm64" \
	"$(expected tcab-backend deployments/images/services.Dockerfile arm64 "--target backend")" "$(build_line)"

out="$(run backend "$SHA")"
check_equal "creates the container builder first" \
	"docker buildx create --name tcab-ci --driver docker-container --use [cwd=$repo]" "$(head -1 "$tmp/docker.log")"
out="$(STUB_CREATE_EXIT=1 run backend "$SHA")"
check_equal "a builder that already exists is reused" "0" "$?"
check_contains "by name" "docker buildx use tcab-ci" "$(cat "$tmp/docker.log")"

# TCAB_PREBUILT_GG replaces the `gg-build` stage for the two targets that copy out of it,
# and only those: the flag goes last, after every other argument.
out="$(TCAB_PREBUILT_GG=/stage/gg run backend "$SHA")"
check_equal "backend with a prebuilt gg builds" "0" "$?"
check_equal "and takes it as the gg-build named context" \
	"$(expected tcab-backend deployments/images/services.Dockerfile amd64 "--target backend --build-context gg-build=/stage/gg")" \
	"$(build_line)"
out="$(TCAB_PREBUILT_GG=/stage/gg run driver "$SHA")"
check_equal "driver with a prebuilt gg builds" "0" "$?"
check_equal "and takes it after the audio store" \
	"$(expected tcab-driver deployments/images/services.Dockerfile amd64 "--target driver --build-arg AUDIO_STORE_IMAGE=$R/test-cabinet-audio-store:$SHA --build-context gg-build=/stage/gg")" \
	"$(build_line)"
for service in dispatcher web; do
	out="$(TCAB_PREBUILT_GG=/stage/gg run "$service" "$SHA")"
	check_lacks "$service ignores a prebuilt gg" "gg-build" "$(build_line)"
done
out="$(TCAB_PREBUILT_GG="" run backend "$SHA")"
check_lacks "an empty TCAB_PREBUILT_GG keeps the Dockerfile's own stage" "--build-context" "$(build_line)"

out="$(run gateway "$SHA")"
check_equal "an unknown service fails" "1" "$?"
check_contains "naming it" "unknown service 'gateway'" "$out"
check_equal "and builds nothing" "" "$(cat "$tmp/docker.log")"

out="$(run backend)"
check_equal "no sha is a usage error" "1" "$?"
check_contains "which says how to call it" "usage: scripts/ci/service-image.sh <service> <sha>" "$out"

echo
echo "service-image.test.sh: ${pass} passed, ${fail} failed"
[ "$fail" -eq 0 ]
