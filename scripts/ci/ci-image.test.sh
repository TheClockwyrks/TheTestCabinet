#!/usr/bin/env bash
# Table test for ci-image.sh and for ci/images/build-args.sh, which it drives.
# Run it directly: ./ci-image.test.sh
#
# The gates pipeline builds nothing. It names each job's CI image by the commit
# ci/images/tags.yml pins and lets the agent pull it, so the reference this
# script pushes is the whole of what ties a gate run to the toolchain it ran
# in. That leaves three ways to fail quietly: an image tagged with anything but
# the commit the run is on, which no pin can then name; an image built without
# the pins the compose file's anchor decides, which is a toolchain nobody
# reviewed; and a build that did not push, which leaves a pin naming nothing.
# So `build` is driven with and without BUILD_SOURCEVERSION, with pins that can
# and cannot be read, and with a builder that is and is not there, and what
# reached the builder is read back.
#
# Every case runs against a throwaway checkout of its own: a `git init` holding
# the two scripts, the Dockerfiles and the compose file, committed once so that
# `git rev-parse HEAD` answers. `docker` first on PATH records what it was asked
# for and runs nothing, so no case contacts a registry, builds an image or
# needs a daemon.
set -uo pipefail

CI_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly CI_DIR
REPO_ROOT="$(cd "$CI_DIR/../.." && pwd)"
readonly REPO_ROOT

readonly TRACKS=(rust rust-browser web)
readonly REGISTRY="testcabinet.azurecr.io"
readonly BUILDER="the-test-cabinet-ci-images"
readonly COMPOSE=".devcontainer/docker-compose.yml"
# A commit as Azure names one, which no checkout here is on.
readonly AZURE_COMMIT="0123456789abcdef0123456789abcdef01234567"

pass=0
fail=0

# What Azure sets, and whether a create or a build fails. They are plain
# variables rather than assignments written in front of a call, because bash
# leaves those set after a function returns. An empty SOURCE_VERSION is a run
# with no BUILD_SOURCEVERSION at all, which is a run from a terminal.
SOURCE_VERSION="$AZURE_COMMIT"
STUB_CREATE_STATUS=0
STUB_BUILD_STATUS=0

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

check_absent() { # label needle haystack
	if grep -qF -- "$2" <<<"$3"; then
		bad "$1" "expected output without: $2" "got: ${3:-<empty>}"
	else
		ok "$1"
	fi
}

check_empty() { # label actual
	if [ -z "$2" ]; then
		ok "$1"
	else
		bad "$1" "expected no output" "got: $2"
	fi
}

if ! command -v git >/dev/null 2>&1; then
	echo "git is not installed here; an image run from a terminal is tagged with git's HEAD."
	echo "Skipping the ci-image test."
	exit 0
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

readonly STUB_LOG="$tmp/stub.log"
readonly OUT="$tmp/stdout"
readonly ERR="$tmp/stderr"
readonly CHECKOUT="$tmp/checkout"
# The directory a run is made from, which is the checkout's root everywhere but
# the one case that runs from below it.
RUN_DIR="$CHECKOUT"

# A `docker` that runs nothing. Every call is written to the log as the command
# line it was given, so a case reads back what the script asked the builder for.
# The two status variables let a create or a build fail.
stubs="$tmp/bin"
mkdir -p "$stubs"
cat >"$stubs/docker" <<'STUB'
#!/usr/bin/env bash
printf 'docker: %s\n' "$*" >>"$STUB_LOG"
case "${1:-} ${2:-}" in
"buildx create") exit "${STUB_CREATE_STATUS:-0}" ;;
"buildx build") exit "${STUB_BUILD_STATUS:-0}" ;;
esac
exit 0
STUB
chmod +x "$stubs/docker"

# The files the scripts are, plus the one file the pins are read out of.
readonly COPIED=(
	scripts/ci/ci-image.sh
	ci/images/build-args.sh
	"$COMPOSE"
)

# Runs the script in the throwaway checkout, from its root or from RUN_DIR,
# with the stubbed docker first on PATH. The git variables are dropped because a
# commit hook sets them: the script would otherwise find the repository being
# committed to rather than the checkout it was run in, and name that one's HEAD.
# BUILD_SOURCEVERSION is dropped and set again only from SOURCE_VERSION,
# because the pipeline running this test sets it too.
image() { # arguments...
	: >"$STUB_LOG"
	local source=()
	if [ -n "$SOURCE_VERSION" ]; then
		source=(BUILD_SOURCEVERSION="$SOURCE_VERSION")
	fi
	(
		cd "$RUN_DIR" || exit 1
		env -u GIT_DIR -u GIT_WORK_TREE -u GIT_INDEX_FILE -u GIT_PREFIX \
			-u GIT_OBJECT_DIRECTORY -u GIT_ALTERNATE_OBJECT_DIRECTORIES \
			-u GIT_CEILING_DIRECTORIES -u BUILD_SOURCEVERSION \
			PATH="$stubs:$PATH" \
			STUB_LOG="$STUB_LOG" \
			STUB_CREATE_STATUS="$STUB_CREATE_STATUS" \
			STUB_BUILD_STATUS="$STUB_BUILD_STATUS" \
			"${source[@]}" \
			"$CHECKOUT/scripts/ci/ci-image.sh" "$@"
	) >"$OUT" 2>"$ERR"
	status=$?
	out="$(cat "$OUT")"
	err="$(cat "$ERR")"
	log="$(cat "$STUB_LOG")"
	return "$status"
}

# Runs ci/images/build-args.sh in the throwaway checkout.
pins() { # track...
	(
		cd "$CHECKOUT" || exit 1
		"$CHECKOUT/ci/images/build-args.sh" "$@"
	) >"$OUT" 2>"$ERR"
	status=$?
	out="$(cat "$OUT")"
	err="$(cat "$ERR")"
	return "$status"
}

# Runs git in the throwaway checkout. The variables a commit hook sets are
# dropped here too: left in place, a `git init` would re-initialize the
# repository being committed to instead of creating this one.
git_checkout() { # arguments...
	env -u GIT_DIR -u GIT_WORK_TREE -u GIT_INDEX_FILE -u GIT_PREFIX \
		-u GIT_OBJECT_DIRECTORY -u GIT_ALTERNATE_OBJECT_DIRECTORIES \
		-u GIT_CEILING_DIRECTORIES \
		git -C "$CHECKOUT" "$@"
}

# The `--build-arg` flags the pins of a track make, in the order build-args.sh
# prints them, each with the space that separates it from the flag before.
build_args_of() { # track
	local pin flags=""
	pins "$1"
	while read -r pin; do
		[ -n "$pin" ] || continue
		flags+=" --build-arg $pin"
	done <<<"$out"
	printf '%s' "$flags"
}

# A checkout of the two scripts, the Dockerfiles and the compose file,
# committed once, or left with no commit at all when asked.
fresh_checkout() { # [uncommitted]
	rm -rf "$CHECKOUT"
	mkdir -p "$CHECKOUT"
	git_checkout init --quiet >/dev/null

	local relative track
	for relative in "${COPIED[@]}"; do
		mkdir -p "$CHECKOUT/$(dirname "$relative")"
		cp "$REPO_ROOT/$relative" "$CHECKOUT/$relative"
	done
	for track in "${TRACKS[@]}"; do
		cp "$REPO_ROOT/ci/images/${track}.Dockerfile" "$CHECKOUT/ci/images/${track}.Dockerfile"
	done
	git_checkout add --all >/dev/null
	if [ "${1:-}" != uncommitted ]; then
		git_checkout -c user.name=test -c user.email=test@example.invalid \
			commit --quiet --no-verify --no-gpg-sign --message "the images' files" >/dev/null
	fi
}

fresh_checkout

echo "--- a run Azure names the commit of ---"

repositories=""
for track in "${TRACKS[@]}"; do
	repository="$REGISTRY/ubuntu-the-test-cabinet-${track}-cicd"
	reference="$repository:$AZURE_COMMIT"
	build_args="$(build_args_of "$track")"
	# rust-browser is built on the Rust image this run pushed, at its commit.
	if [ "$track" = rust-browser ]; then
		build_args+=" --build-arg RUST_CI_IMAGE=$REGISTRY/ubuntu-the-test-cabinet-rust-cicd:$AZURE_COMMIT"
	fi
	cache="type=registry,ref=${repository}-cache:latest"

	image build "$track"
	check_equal "the $track build exits 0" 0 "$status"
	check_contains "it reports the $track push" "Pushed $reference" "$out"
	check_contains "it says what the $track commit is for" "write $AZURE_COMMIT into ci/images/tags.yml as ciImageTag" "$out"
	check_contains "it creates the builder" \
		"docker: buildx create --name $BUILDER --driver docker-container --use" "$log"
	check_contains "the $track builder is handed the commit's tag, the pins, the platform and the caches, and pushes" \
		"docker: buildx build --platform linux/amd64 --file ci/images/${track}.Dockerfile --tag ${reference}${build_args} --cache-from ${cache} --cache-to ${cache},mode=max --push ." \
		"$log"
	check_equal "the $track run asks docker for nothing but the builder and the build" 2 "$(grep -c . <<<"$log")"
	check_absent "the $track build signs in to no registry itself" "login" "$log"
	check_absent "the $track build asks the registry nothing first" "imagetools" "$log"
	repositories+="$repository"$'\n'
done

# A `docker image ls` and the registry's own listing say which track an image
# belongs to without reading its tag.
check_equal "each track is pushed to a repository of its own" \
	"${#TRACKS[@]}" "$(sort -u <<<"$repositories" | grep -c .)"

echo "--- a run from a terminal ---"

head_commit="$(git_checkout rev-parse HEAD)"
SOURCE_VERSION=""
image build rust
check_equal "a run with no BUILD_SOURCEVERSION exits 0" 0 "$status"
check_contains "it tags the image with the checkout's HEAD" \
	"--tag $REGISTRY/ubuntu-the-test-cabinet-rust-cicd:$head_commit " "$log"
check_absent "and not with a commit the run is not on" "$AZURE_COMMIT" "$log"

image build rust-browser
check_equal "a rust-browser run from a terminal exits 0" 0 "$status"
check_contains "it builds on the Rust image of the checkout's HEAD" \
	"--build-arg RUST_CI_IMAGE=$REGISTRY/ubuntu-the-test-cabinet-rust-cicd:$head_commit " "$log"

# Every path the script names is relative to the root: the Dockerfile, the
# build context and ci/images/build-args.sh.
RUN_DIR="$CHECKOUT/ci/images"
image build web
RUN_DIR="$CHECKOUT"
check_equal "a run from below the root exits 0" 0 "$status"
check_contains "and builds the same files from the root" \
	"--file ci/images/web.Dockerfile --tag $REGISTRY/ubuntu-the-test-cabinet-web-cicd:$head_commit " "$log"

# A checkout with no commit has nothing a tag could name.
fresh_checkout uncommitted
image build rust
check_equal "a checkout with no commit fails" 1 "$status"
check_contains "it says there is nothing to tag the image with" "nothing to tag the image with" "$err"
check_empty "it reaches no docker" "$log"
check_absent "it reports no push" "Pushed" "$out"
fresh_checkout
SOURCE_VERSION="$AZURE_COMMIT"

# Only a full object id is a pin the tags file accepts, so nothing else is
# pushed as one.
for bogus in latest 0123456 "${AZURE_COMMIT^^}"; do
	SOURCE_VERSION="$bogus"
	image build rust
	check_equal "a BUILD_SOURCEVERSION of '$bogus' fails" 1 "$status"
	check_contains "it says '$bogus' is no commit id" "is not a full commit id" "$err"
	check_empty "it reaches no docker" "$log"
done
SOURCE_VERSION="$AZURE_COMMIT"

echo "--- the build arguments are the pins the anchor decides ---"

# Read back from the build line rather than from build-args.sh alone, so a pin
# printed but dropped on the way to the builder fails here.
image build rust
pins rust
while read -r pin; do
	[ -n "$pin" ] || continue
	check_contains "the rust build is handed ${pin%%=*}" "--build-arg $pin " "$log"
done <<<"$out"
check_contains "the rust build is handed the test runner the anchor pins" \
	"--build-arg NEXTEST_VERSION=$(sed -n 's/^ *NEXTEST_VERSION: *//p' "$CHECKOUT/$COMPOSE") " "$log"

image build web
pins web
while read -r pin; do
	[ -n "$pin" ] || continue
	check_contains "the web build is handed ${pin%%=*}" "--build-arg $pin " "$log"
done <<<"$out"

for track in rust web; do
	image build "$track"
	check_absent "the $track build is built on no other track's image" "RUST_CI_IMAGE" "$log"
done

image build rust-browser
pins rust-browser
while read -r pin; do
	[ -n "$pin" ] || continue
	check_contains "the rust-browser build is handed ${pin%%=*}" "--build-arg $pin " "$log"
done <<<"$out"
check_equal "the rust-browser image takes Node and Playwright alone from the anchor" \
	"NODE_VERSION PLAYWRIGHT_VERSION" "$(cut -d= -f1 <<<"$out" | paste -sd ' ')"
check_absent "its base image is no pin of the anchor's" "RUST_CI_IMAGE" "$out"

pins rust
check_contains "the rust image is built with the compiler the anchor pins" \
	"RUST_VERSION=$(sed -n 's/^ *RUST_VERSION: *//p' "$CHECKOUT/$COMPOSE")" "$out"
check_contains "the rust image is built with the test runner the anchor pins" \
	"NEXTEST_VERSION=$(sed -n 's/^ *NEXTEST_VERSION: *//p' "$CHECKOUT/$COMPOSE")" "$out"
check_contains "the rust image is built with the amd64 archive checksum the anchor pins" \
	"NEXTEST_SHA256_AMD64=$(sed -n 's/^ *NEXTEST_SHA256_AMD64: *//p' "$CHECKOUT/$COMPOSE")" "$out"
check_contains "the rust image is built with the arm64 archive checksum the anchor pins" \
	"NEXTEST_SHA256_ARM64=$(sed -n 's/^ *NEXTEST_SHA256_ARM64: *//p' "$CHECKOUT/$COMPOSE")" "$out"
check_contains "the rust image is built with the linker the anchor pins" \
	"MOLD_VERSION=$(sed -n 's/^ *MOLD_VERSION: *//p' "$CHECKOUT/$COMPOSE")" "$out"
check_contains "the rust image is built with the linker's amd64 archive checksum the anchor pins" \
	"MOLD_SHA256_AMD64=$(sed -n 's/^ *MOLD_SHA256_AMD64: *//p' "$CHECKOUT/$COMPOSE")" "$out"
check_contains "the rust image is built with the linker's arm64 archive checksum the anchor pins" \
	"MOLD_SHA256_ARM64=$(sed -n 's/^ *MOLD_SHA256_ARM64: *//p' "$CHECKOUT/$COMPOSE")" "$out"
check_absent "an ARG carrying its own default is the Dockerfile's business" \
	"DEBIAN_FRONTEND=" "$out"
check_absent "a pin no image installs is not passed to the build" \
	"CLAUDE_CODE_VERSION=" "$out"
check_equal "the pins are sorted" "$out" "$(sort <<<"$out")"

pins web
check_contains "the web image is built with the Node the anchor pins" \
	"NODE_VERSION=$(sed -n 's/^ *NODE_VERSION: *//p' "$CHECKOUT/$COMPOSE")" "$out"
check_contains "the web image is built with the Playwright the anchor pins" \
	"PLAYWRIGHT_VERSION=$(sed -n 's/^ *PLAYWRIGHT_VERSION: *//p' "$CHECKOUT/$COMPOSE")" "$out"

# Pins that cannot be read are no image anybody reviewed, and the failure is
# found before the builder is created, let alone handed a build.
printf '\nARG BUN_VERSION\n' >>"$CHECKOUT/ci/images/web.Dockerfile"
image build web
check_equal "pins that cannot be read fail the build" 1 "$status"
check_contains "it says which reader failed" "build-args.sh web failed" "$err"
check_contains "and passes on what the reader said" "BUN_VERSION" "$err"
check_empty "it reaches no docker" "$log"
check_absent "it reports no push" "Pushed" "$out"
fresh_checkout

echo "--- the builder and a build that fails ---"

# A job retried on an agent it has run on before finds the builder in place.
STUB_CREATE_STATUS=1
image build rust
STUB_CREATE_STATUS=0
check_equal "a builder that is already there is used rather than recreated" 0 "$status"
check_contains "it is selected instead" "docker: buildx use $BUILDER" "$log"
check_contains "and the build still runs" "docker: buildx build" "$log"

# `set -e` has to survive the function call, and a red push must not print
# `Pushed`.
STUB_BUILD_STATUS=1
image build rust
STUB_BUILD_STATUS=0
check_equal "a build that fails fails the run" 1 "$status"
check_absent "a build that failed reports no push" "Pushed" "$out"
check_absent "and names no commit to pin" "ciImageTag" "$out"

echo "--- the guards ---"

image build bogus
check_equal "an unknown track fails" 1 "$status"
check_contains "it names the track" "unknown track 'bogus'" "$err"
check_empty "it prints nothing on stdout" "$out"
check_empty "it reaches no docker" "$log"

image
check_equal "no arguments fails" 1 "$status"
check_contains "no arguments prints the usage" "usage: scripts/ci/ci-image.sh build" "$err"
check_empty "no arguments prints nothing on stdout" "$out"

image build
check_equal "no track fails" 1 "$status"
check_contains "no track prints the usage" "usage: scripts/ci/ci-image.sh build" "$err"

image build rust extra
check_equal "too many arguments fails" 1 "$status"
check_contains "too many arguments prints the usage" "usage: scripts/ci/ci-image.sh build" "$err"
check_empty "too many arguments reaches no docker" "$log"

# `build` is the one subcommand; the ones that computed and wrote a tag are
# gone, and naming one is a usage error rather than a build.
for subcommand in inputs tag reference publish; do
	image "$subcommand" rust
	check_equal "\`$subcommand rust\` fails" 1 "$status"
	check_contains "\`$subcommand rust\` prints the usage" "usage: scripts/ci/ci-image.sh build" "$err"
	check_empty "\`$subcommand rust\` prints nothing on stdout" "$out"
	check_empty "\`$subcommand rust\` reaches no docker" "$log"
done

image tag
check_equal "\`tag\` alone fails" 1 "$status"
check_contains "\`tag\` alone prints the usage" "usage: scripts/ci/ci-image.sh build" "$err"

echo "--- build-args.sh ---"

fresh_checkout

pins
status=$?
check_equal "no track fails" 2 "$status"
check_contains "no track prints the usage" "usage: build-args.sh" "$err"
check_empty "no track prints nothing on stdout" "$out"

pins bogus
status=$?
check_equal "an unknown track fails" 2 "$status"
check_contains "an unknown track prints the usage" "usage: build-args.sh" "$err"

# An unpinned ARG reaches the build as an empty string, and an empty version
# installs whatever is current that day.
printf '\nARG BUN_VERSION\n' >>"$CHECKOUT/ci/images/web.Dockerfile"
pins web
status=$?
check_equal "an ARG the anchor does not decide is refused" 1 "$status"
check_contains "it is named" "BUN_VERSION" "$err"
check_contains "and the file to add it to is named" "x-devcontainer-build-args" "$err"
check_empty "and nothing is printed for the build to consume" "$out"

# A value that interpolates the host is no pin a CI image can consume: the uid
# pair is a property of a developer's machine. An image that asked for one
# therefore gets the missing-pin error, which is the only way to see from the
# outside that it was skipped.
fresh_checkout
printf '\nARG USER_UID\n' >>"$CHECKOUT/ci/images/rust.Dockerfile"
pins rust
status=$?
check_equal "an interpolated entry is no pin" 1 "$status"
check_contains "the ARG that asked for it is named" "USER_UID" "$err"
check_absent "and no value with a dollar in it is printed" '$' "$out"

# No pins at all is not an image with few dependencies; it is an unreproducible
# one.
fresh_checkout
printf 'FROM docker.io/library/ubuntu:26.04\nARG DEBIAN_FRONTEND=noninteractive\nRUN true\n' \
	>"$CHECKOUT/ci/images/rust.Dockerfile"
pins rust
status=$?
check_equal "a Dockerfile that declares no pins is refused" 1 "$status"
check_contains "it says so" "declares no ARG lines" "$err"

# The one place a version is decided; without it there is nothing to read.
fresh_checkout
printf 'services:\n  dev:\n    build:\n      context: .\n' >"$CHECKOUT/$COMPOSE"
pins web
status=$?
check_equal "a compose file with no anchor is refused" 1 "$status"
check_contains "it names the file" "docker-compose.yml" "$err"

# A Dockerfile that is not there would otherwise read as an image with no pins.
fresh_checkout
rm -f "$CHECKOUT/ci/images/web.Dockerfile"
pins web
status=$?
check_equal "a track with no image is refused" 1 "$status"
check_contains "it says which one" "no such image" "$err"

printf '\n%d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
