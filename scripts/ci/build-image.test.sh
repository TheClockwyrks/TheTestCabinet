#!/usr/bin/env bash
# Table test for build-image.sh. Run it directly: ./build-image.test.sh
#
# No case reaches a container runtime or a registry. Each builds a throwaway
# repository holding the script, a Dockerfile and a stub client first on PATH
# that records every invocation's arguments and answers `info`, `version`,
# `run`, `pull`, `build`, `tag`, `push` and `inspect`.
#
# The subject is what the script asks the client for: the two references it
# builds and tags, the platform and the label the build carries, the QEMU
# registration a foreign platform on docker runs first, the order the two
# pushes go in, the cache repository it reads and writes, the client it
# resolves and the arguments it refuses to run on.
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

check_failed() { # label status
	if [ "$2" -ne 0 ]; then
		ok "$1"
	else
		bad "$1" "expected a non-zero exit" "got exit 0"
	fi
}

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

REGISTRY="registry.example.invalid/tools"
COMMIT="0123456789abcdef0123456789abcdef01234567"
DIGEST="sha256:5f0b1d3a4c2e6f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a"
SERVER_COMMIT_REF="$REGISTRY/the-test-cabinet-backend:$COMMIT"
SERVER_LATEST_REF="$REGISTRY/the-test-cabinet-backend:latest"
DOCKERFILE="deployments/images/backend.Dockerfile"
BINFMT_IMAGE="docker.io/tonistiigi/binfmt:qemu-v10.2.3"
# The platform the project answered its images are built for.
DEFAULT_PLATFORM="linux/arm64"

# A repository holding the script, both Dockerfiles and three stub clients: one
# named podman and one named docker, which is what the resolution below picks
# between, and one named buildtool, which only CONTAINER_TOOL reaches. The
# docker stub reports a daemon of STUB_ARCH, amd64 while a case leaves it
# unset, which is the hosted agent's architecture, and nothing at all when a
# case sets it empty.
fresh_repo() {
	local repo
	# From mktemp rather than a counter, because this runs inside a command
	# substitution and a variable a subshell increments is gone when it exits.
	repo="$(mktemp -d "$tmp/repoXXXXXX")"
	mkdir -p "$repo/scripts/ci" "$repo/bin" "$repo/deployments/images"
	cp "$CI_DIR/lib.sh" "$CI_DIR/build-image.sh" "$repo/scripts/ci/"
	printf 'FROM scratch\n' >"$repo/deployments/images/backend.Dockerfile"

	cat >"$repo/bin/podman" <<'STUB'
#!/usr/bin/env bash
# Records `<client> <arguments…>` and answers the subcommands the script runs.
printf '%s %s\n' "$(basename "$0")" "$*" >>"$CLIENT_LOG"
case "${1:-}" in
info) exit "${STUB_INFO_STATUS:-0}" ;;
version) printf '%s\n' "${STUB_ARCH-amd64}" ;;
run) exit "${STUB_RUN_STATUS:-0}" ;;
pull) exit "${STUB_PULL_STATUS:-0}" ;;
# `buildx inspect` is how the script asks whether its builder exists;
# a case that wants it created answers no.
buildx) [ "${2:-}" = "inspect" ] && exit "${STUB_BUILDER_STATUS:-0}" ;;
push) exit "${STUB_PUSH_STATUS:-0}" ;;
inspect) printf '%s\n' "${STUB_DIGESTS:-}" ;;
esac
exit 0
STUB
	chmod +x "$repo/bin/podman"
	cp "$repo/bin/podman" "$repo/bin/docker"
	cp "$repo/bin/podman" "$repo/bin/buildtool"

	printf '%s' "$repo"
}

# Runs the script in $1 from /, by an absolute path, with the environment the
# arguments before `--` name and the script arguments after it. With no `--`
# section it builds the server image.
run() { # repo [VAR=value …] [-- argument…]
	local repo="$1"
	shift
	local environment=()
	while [ "$#" -gt 0 ] && [ "$1" != "--" ]; do
		environment+=("$1")
		shift
	done
	[ "${1:-}" = "--" ] && shift
	[ "$#" -gt 0 ] || set -- the-test-cabinet-backend "$DOCKERFILE"
	(
		cd / || exit 1
		env -u CONTAINER_TOOL -u THE_TEST_CABINET_PUSH -u THE_TEST_CABINET_IMAGE_CACHE -u THE_TEST_CABINET_PLATFORM \
			PATH="$repo/bin:$PATH" \
			CLIENT_LOG="$repo/client.log" \
			THE_TEST_CABINET_REGISTRY="$REGISTRY" \
			THE_TEST_CABINET_COMMIT="$COMMIT" \
			STUB_DIGESTS="$REGISTRY/the-test-cabinet-backend@$DIGEST" \
			${environment[@]+"${environment[@]}"} \
			"$repo/scripts/ci/build-image.sh" "$@" 2>&1
	)
}

# The first recorded invocation whose subcommand is $2, or the empty string.
verb_line() { # repo verb
	awk -v verb="$2" '$2 == verb { print; exit }' "$1/client.log" 2>/dev/null
}

# The references, in order, the recorded invocations of $2 were given.
verb_targets() { # repo verb
	awk -v verb="$2" '$2 == verb { print $3 }' "$1/client.log" 2>/dev/null
}

# The first recorded build, whichever subcommand the client spells it as: the
# registry cache is read and written through `docker buildx build`, and every
# other build is a plain `build`.
build_line_of() { # repo
	awk '$2 == "build" || ($2 == "buildx" && $3 == "build") { print; exit }' "$1/client.log" 2>/dev/null
}

# Every recorded invocation, as one string.
client_log() { # repo
	cat "$1/client.log" 2>/dev/null
}

# The position, counting from 1, of the first recorded invocation whose
# subcommand is $2, or the empty string.
verb_position() { # repo verb
	awk -v verb="$2" '$2 == verb { print NR; exit }' "$1/client.log" 2>/dev/null
}

echo "--- what the build asks for ---"

repo="$(fresh_repo)"
out="$(run "$repo")"
status=$?
check_equal "exits 0" 0 "$status"

build_line="$(verb_line "$repo" build)"
check_contains "builds the commit tag under the registry prefix" \
	"-t $SERVER_COMMIT_REF" "$build_line"
check_contains "names the platform in the command" "--platform $DEFAULT_PLATFORM" "$build_line"
check_contains "labels the build with the commit" \
	"--label org.opencontainers.image.revision=$COMMIT" "$build_line"
check_contains "hands the build the commit" \
	"--build-arg THE_TEST_CABINET_COMMIT=$COMMIT" "$build_line"
check_contains "names the Dockerfile it was given" "-f $DOCKERFILE" "$build_line"
check_contains "takes the repository root as the context" " $repo" "$build_line"
check_equal "builds once" 1 "$(verb_targets "$repo" build | wc -l)"

check_equal "tags that same build latest" \
	"podman tag $SERVER_COMMIT_REF $SERVER_LATEST_REF" "$(verb_line "$repo" tag)"

echo "--- the platform the image is built for ---"

repo="$(fresh_repo)"
out="$(run "$repo")"
status=$?
check_equal "exits 0" 0 "$status"
check_contains "an unset THE_TEST_CABINET_PLATFORM builds for $DEFAULT_PLATFORM, the cluster's" \
	"--platform $DEFAULT_PLATFORM" "$(verb_line "$repo" build)"
check_contains "and says so" "for $DEFAULT_PLATFORM" "$out"

repo="$(fresh_repo)"
out="$(run "$repo" THE_TEST_CABINET_PLATFORM=linux/arm64)"
status=$?
check_equal "exits 0" 0 "$status"
check_contains "THE_TEST_CABINET_PLATFORM=linux/arm64 builds for linux/arm64" \
	"--platform linux/arm64" "$(verb_line "$repo" build)"
check_lacks "and no other platform" "linux/amd64" "$(verb_line "$repo" build)"

repo="$(fresh_repo)"
out="$(run "$repo" THE_TEST_CABINET_PLATFORM=linux/amd64)"
status=$?
check_equal "exits 0" 0 "$status"
check_contains "THE_TEST_CABINET_PLATFORM=linux/amd64 builds for linux/amd64" \
	"--platform linux/amd64" "$(verb_line "$repo" build)"
check_lacks "and no other platform" "linux/arm64" "$(verb_line "$repo" build)"

repo="$(fresh_repo)"
out="$(run "$repo" THE_TEST_CABINET_PLATFORM=linux/riscv64)"
status=$?
check_failed "a platform the Dockerfiles have no build for fails" "$status"
check_contains "names the variable" "THE_TEST_CABINET_PLATFORM" "$out"
check_equal "and builds nothing" "" "$(verb_line "$repo" build)"

echo "--- QEMU is registered for a foreign platform on docker alone ---"

# The docker stub is an amd64 daemon unless a case says otherwise, which is
# the hosted agent's. Every case names the platform, so what it registers does
# not hang on the one the project answered.
repo="$(fresh_repo)"
out="$(run "$repo" STUB_INFO_STATUS=1 THE_TEST_CABINET_PLATFORM=linux/amd64)"
status=$?
check_equal "exits 0" 0 "$status"
check_equal "docker on amd64 building for amd64 registers nothing" "" "$(verb_line "$repo" run)"
check_contains "and the build loads into the image store" "--load" "$(verb_line "$repo" build)"

repo="$(fresh_repo)"
out="$(run "$repo" STUB_INFO_STATUS=1 THE_TEST_CABINET_PLATFORM=linux/arm64)"
status=$?
check_equal "exits 0" 0 "$status"
check_equal "docker on amd64 building for arm64 registers QEMU for arm64 from the pinned image" \
	"docker run --privileged --rm $BINFMT_IMAGE --install arm64" "$(verb_line "$repo" run)"
check_equal "registers it once" 1 "$(verb_targets "$repo" run | wc -l)"
run_at="$(verb_position "$repo" run)"
build_at="$(verb_position "$repo" build)"
if [ -n "$run_at" ] && [ -n "$build_at" ] && [ "$run_at" -lt "$build_at" ]; then
	ok "and before the build"
else
	bad "and before the build" "the registration is invocation ${run_at:-<none>} and the build is ${build_at:-<none>}"
fi

repo="$(fresh_repo)"
out="$(run "$repo" STUB_INFO_STATUS=1 STUB_ARCH=arm64 THE_TEST_CABINET_PLATFORM=linux/amd64)"
status=$?
check_equal "exits 0" 0 "$status"
check_equal "docker on arm64 building for amd64 registers QEMU for amd64" \
	"docker run --privileged --rm $BINFMT_IMAGE --install amd64" "$(verb_line "$repo" run)"

repo="$(fresh_repo)"
out="$(run "$repo" STUB_INFO_STATUS=1 STUB_ARCH=arm64 THE_TEST_CABINET_PLATFORM=linux/arm64)"
status=$?
check_equal "exits 0" 0 "$status"
check_equal "docker on arm64 building for arm64 registers nothing" "" "$(verb_line "$repo" run)"

repo="$(fresh_repo)"
out="$(run "$repo" STUB_INFO_STATUS=1 STUB_ARCH= THE_TEST_CABINET_PLATFORM=linux/amd64)"
status=$?
check_equal "exits 0" 0 "$status"
check_equal "a daemon that reports no architecture is treated as foreign" \
	"docker run --privileged --rm $BINFMT_IMAGE --install amd64" "$(verb_line "$repo" run)"

repo="$(fresh_repo)"
out="$(run "$repo" STUB_INFO_STATUS=1 STUB_RUN_STATUS=1 THE_TEST_CABINET_PLATFORM=linux/arm64)"
status=$?
check_failed "a registration that fails fails the run" "$status"
check_contains "names the platform of the host as the way round it" \
	"THE_TEST_CABINET_PLATFORM=linux/amd64" "$out"
check_equal "and builds nothing" "" "$(verb_line "$repo" build)"

repo="$(fresh_repo)"
out="$(run "$repo" THE_TEST_CABINET_PLATFORM=linux/arm64)"
status=$?
check_equal "exits 0" 0 "$status"
check_equal "podman registers nothing, whatever the platform" "" "$(verb_line "$repo" run)"
check_equal "and asks the daemon nothing" "" "$(verb_line "$repo" version)"
check_contains "and still builds for the platform" "--platform linux/arm64" "$(verb_line "$repo" build)"

echo "--- an explicit context ---"

repo="$(fresh_repo)"
out="$(run "$repo" -- the-test-cabinet-backend deployments/images/backend.Dockerfile "$repo/deployments")"
status=$?
check_equal "exits 0" 0 "$status"
build_line="$(verb_line "$repo" build)"
check_contains "builds the server image" "-t $REGISTRY/the-test-cabinet-backend:$COMMIT" "$build_line"
check_contains "builds from the directory it was given" " $repo/deployments" "$build_line"

echo "--- an unset THE_TEST_CABINET_PUSH stops before the registry ---"

repo="$(fresh_repo)"
out="$(run "$repo")"
status=$?
check_equal "exits 0" 0 "$status"
check_equal "records no push" "" "$(verb_line "$repo" push)"
check_contains "says it did not contact the registry" "THE_TEST_CABINET_PUSH is not 1" "$out"
check_contains "names the commit reference it built" "$SERVER_COMMIT_REF" "$out"
check_contains "names the latest reference it tagged" "$SERVER_LATEST_REF" "$out"

echo "--- THE_TEST_CABINET_PUSH=1 publishes both tags ---"

repo="$(fresh_repo)"
out="$(run "$repo" THE_TEST_CABINET_PUSH=1)"
status=$?
check_equal "exits 0" 0 "$status"
pushes="$(verb_targets "$repo" push)"
check_equal "pushes the commit tag first" "$SERVER_COMMIT_REF" "$(printf '%s\n' "$pushes" | sed -n 1p)"
check_equal "then moves latest onto it" "$SERVER_LATEST_REF" "$(printf '%s\n' "$pushes" | sed -n 2p)"
check_equal "pushes twice and no more" 2 "$(printf '%s\n' "$pushes" | sed '/^$/d' | wc -l)"
check_contains "prints the commit reference with its digest" \
	"pushed $SERVER_COMMIT_REF $DIGEST" "$out"
check_contains "prints the latest reference with its digest" \
	"pushed $SERVER_LATEST_REF $DIGEST" "$out"

repo="$(fresh_repo)"
out="$(run "$repo" THE_TEST_CABINET_PUSH=1 STUB_PUSH_STATUS=1)"
status=$?
check_failed "a failed push fails the run" "$status"
check_contains "names the registry sign-in a push by hand runs first" "az acr login --name registry" "$out"

echo "--- THE_TEST_CABINET_IMAGE_CACHE=1 reads and writes the cache repository ---"

# The cache repository sits beside the image and is never the image, so a run
# that reads it pulls no published tag.
CACHE_REF="$REGISTRY/the-test-cabinet-backend-cache:latest"

repo="$(fresh_repo)"
out="$(run "$repo" THE_TEST_CABINET_IMAGE_CACHE=1)"
status=$?
check_equal "exits 0" 0 "$status"
build_line="$(build_line_of "$repo")"
check_contains "reads the cache repository beside the image" "--cache-from $CACHE_REF" "$build_line"
check_lacks "writes nothing back without a push" "--cache-to" "$build_line"
check_equal "and pulls no published tag" "" "$(verb_line "$repo" pull)"

repo="$(fresh_repo)"
out="$(run "$repo" THE_TEST_CABINET_IMAGE_CACHE=1 THE_TEST_CABINET_PUSH=1)"
status=$?
check_equal "exits 0" 0 "$status"
check_contains "a run that pushes writes the cache back" "--cache-to $CACHE_REF" \
	"$(build_line_of "$repo")"

repo="$(fresh_repo)"
out="$(run "$repo")"
check_lacks "an unset THE_TEST_CABINET_IMAGE_CACHE names no cache" "--cache" "$(build_line_of "$repo")"

repo="$(fresh_repo)"
out="$(run "$repo" STUB_INFO_STATUS=1 THE_TEST_CABINET_IMAGE_CACHE=1 THE_TEST_CABINET_PUSH=1)"
status=$?
check_equal "exits 0" 0 "$status"
build_line="$(build_line_of "$repo")"
check_contains "docker builds through the named builder" \
	"docker buildx build --builder the-test-cabinet-cache" "$build_line"
check_contains "reading every stage's layers from the registry" \
	"--cache-from type=registry,ref=$CACHE_REF" "$build_line"
check_contains "and writing every stage's layers back" \
	"--cache-to type=registry,ref=$CACHE_REF,mode=max" "$build_line"
check_lacks "a builder that answers is not created again" "buildx create" "$(client_log "$repo")"

repo="$(fresh_repo)"
out="$(run "$repo" STUB_INFO_STATUS=1 STUB_BUILDER_STATUS=1 THE_TEST_CABINET_IMAGE_CACHE=1 THE_TEST_CABINET_PUSH=1)"
status=$?
check_equal "exits 0" 0 "$status"
check_contains "a builder that is absent is created on the driver that exports a cache" \
	"docker buildx create --name the-test-cabinet-cache --driver docker-container" \
	"$(client_log "$repo")"

repo="$(fresh_repo)"
out="$(run "$repo" STUB_INFO_STATUS=1 THE_TEST_CABINET_IMAGE_CACHE=1)"
status=$?
check_equal "exits 0" 0 "$status"
check_lacks "a docker build that pushes nothing writes no cache" "--cache-to" \
	"$(build_line_of "$repo")"

echo "--- the client the build runs on ---"

repo="$(fresh_repo)"
out="$(run "$repo" "CONTAINER_TOOL=$repo/bin/buildtool")"
status=$?
check_equal "exits 0" 0 "$status"
check_contains "CONTAINER_TOOL is the client" "buildtool build" "$(verb_line "$repo" build)"
check_equal "and no runtime is probed for one" "" "$(verb_line "$repo" info)"

repo="$(fresh_repo)"
out="$(run "$repo")"
status=$?
check_equal "exits 0" 0 "$status"
check_contains "an unset CONTAINER_TOOL probes the socket" "podman info" "$(verb_line "$repo" info)"
check_contains "a podman that answers is the client" "podman build" "$(verb_line "$repo" build)"
check_lacks "and takes no --load flag" "--load" "$(verb_line "$repo" build)"

repo="$(fresh_repo)"
out="$(run "$repo" STUB_INFO_STATUS=1)"
status=$?
check_equal "exits 0" 0 "$status"
check_contains "a podman that does not answer falls to docker" "docker build" \
	"$(verb_line "$repo" build)"
check_contains "and the docker build is loaded into the image store" "--load" \
	"$(verb_line "$repo" build)"

echo "--- the arguments and the variables it refuses to run on ---"

repo="$(fresh_repo)"
out="$(run "$repo" THE_TEST_CABINET_REGISTRY=)"
status=$?
check_failed "an empty THE_TEST_CABINET_REGISTRY fails" "$status"
check_contains "names the variable" "THE_TEST_CABINET_REGISTRY" "$out"
check_equal "and builds nothing" "" "$(verb_line "$repo" build)"

repo="$(fresh_repo)"
out="$(run "$repo" "THE_TEST_CABINET_COMMIT=${COMMIT:0:39}")"
status=$?
check_failed "a thirty-nine character THE_TEST_CABINET_COMMIT fails" "$status"
check_contains "names the variable" "THE_TEST_CABINET_COMMIT" "$out"
check_equal "and builds nothing" "" "$(verb_line "$repo" build)"

repo="$(fresh_repo)"
out="$(run "$repo" "THE_TEST_CABINET_COMMIT=A${COMMIT:1}")"
status=$?
check_failed "an uppercase letter in THE_TEST_CABINET_COMMIT fails" "$status"
check_contains "names the variable" "THE_TEST_CABINET_COMMIT" "$out"
check_equal "and builds nothing" "" "$(verb_line "$repo" build)"

repo="$(fresh_repo)"
out="$(run "$repo" -- the-test-cabinet-backend deployments/images/absent.Dockerfile)"
status=$?
check_failed "an absent Dockerfile fails" "$status"
check_contains "names the path" "deployments/images/absent.Dockerfile" "$out"
check_equal "and builds nothing" "" "$(verb_line "$repo" build)"

repo="$(fresh_repo)"
out="$(run "$repo" -- the-test-cabinet-backend)"
status=$?
check_failed "a missing Dockerfile argument fails" "$status"
check_contains "prints the usage" "build-image.sh <image> <dockerfile>" "$out"

echo "--- the root is resolved from the script's own path ---"

# Every case above runs the script by an absolute path from /, so a build that
# names this tree's Dockerfile and this tree's context is the assertion that the
# resolution holds away from the repository.
repo="$(fresh_repo)"
out="$(run "$repo")"
status=$?
check_equal "exits 0 invoked from /" 0 "$status"
check_equal "builds against the tree the script sits in" \
	"podman build --platform $DEFAULT_PLATFORM --label org.opencontainers.image.revision=$COMMIT --build-arg THE_TEST_CABINET_COMMIT=$COMMIT -f $DOCKERFILE -t $SERVER_COMMIT_REF $repo" \
	"$(verb_line "$repo" build)"

printf '\n%d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
