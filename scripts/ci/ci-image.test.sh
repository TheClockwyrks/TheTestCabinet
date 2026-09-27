#!/usr/bin/env bash
# Table test for ci-image.sh and for ci/images/build-args.sh, which it drives.
# Run it directly: ./ci-image.test.sh
#
# The gates pipeline builds nothing. It names each job's CI image by the tag
# ci/images/tags.yml holds, which this script writes, and lets the agent pull
# it, so the tag this script prints is the whole of what ties a gate run to the
# toolchain it ran in. That leaves two ways to fail, and neither of them is
# loud.
#
# The first is a tag that is wrong. It digests two things — what git has staged
# for one image's input paths, and the version pins ci/images/build-args.sh
# reads out of the `x-devcontainer-build-args` anchor in
# .devcontainer/docker-compose.yml — and every way that digest can go wrong ends
# in a green run rather than a red one. An unknown track makes the pathspec
# empty, and an empty pathspec is every file in the index, so the tag would be a
# digest of the whole workspace instead of one image's inputs. An input git has
# never seen contributes nothing to it. A pin an image installs has to move its
# tag, and a pin it ignores has to leave it alone, or a perfectly good image is
# retired for nothing — or, worse, a stale one is kept. The cases below change
# one thing at a time in a checkout of their own and read the tag back.
#
# The second is a build that did not happen. The script skips one when the
# registry already holds the tag this checkout names, which is what makes a
# merge cost a minute instead of an hour; skip one wrongly and the gates
# pipeline pins a tag nothing pushed and dies before its first step. So `build`
# is driven against a registry that holds the tag, one that does not, and one
# that cannot answer at all, and what reached the builder is read back.
#
# Every case runs against a throwaway checkout of its own: a `git init` holding
# the two scripts, the Dockerfiles and the compose file, with a placeholder for
# every other input the script lists. The digest is over what git has staged and
# not over what any of it says, so a placeholder is as good as the file.
# `docker` first on PATH records what it was asked for and runs nothing, so no
# case contacts a registry, builds an image or needs a daemon.
set -uo pipefail

CI_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly CI_DIR
REPO_ROOT="$(cd "$CI_DIR/../.." && pwd)"
readonly REPO_ROOT

readonly TRACKS=(rust web)
readonly REGISTRY="testcabinet.azurecr.io"
readonly BUILDER="the-test-cabinet-ci-images"
readonly COMPOSE=".devcontainer/docker-compose.yml"

pass=0
fail=0

# What the stubbed registry says, and whether a create or a build fails. They
# are plain variables rather than assignments written in front of a call,
# because bash leaves those set after a function returns.
STUB_INSPECT=absent
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
	echo "git is not installed here; an image tag is a digest of what git has staged."
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
# STUB_INSPECT decides what the registry says about a tag, and the two status
# variables let a create or a build fail.
stubs="$tmp/bin"
mkdir -p "$stubs"
cat >"$stubs/docker" <<'STUB'
#!/usr/bin/env bash
printf 'docker: %s\n' "$*" >>"$STUB_LOG"

if [ "${1:-} ${2:-} ${3:-}" = "buildx imagetools inspect" ]; then
	case "${STUB_INSPECT:-absent}" in
	present)
		echo "Name: ${4:-}"
		exit 0
		;;
	absent)
		echo "ERROR: ${4:-}: not found" >&2
		exit 1
		;;
	*)
		# A registry that cannot answer: no credential, no network, a 500.
		echo "ERROR: failed to authorize: no basic auth credentials" >&2
		exit 125
		;;
	esac
fi

case "${1:-} ${2:-}" in
"buildx create") exit "${STUB_CREATE_STATUS:-0}" ;;
"buildx build") exit "${STUB_BUILD_STATUS:-0}" ;;
esac
exit 0
STUB
chmod +x "$stubs/docker"

# The files the scripts are, plus the one file the pins are read out of.
# Everything else in the checkout is a placeholder.
readonly COPIED=(
	scripts/ci/ci-image.sh
	ci/images/build-args.sh
	ci/images/tags.yml
	"$COMPOSE"
)
readonly TAGS_FILE="ci/images/tags.yml"

# Runs the script in the throwaway checkout, from its root or from RUN_DIR, with
# the stubbed docker first on PATH. The git variables are dropped because a
# commit hook sets them: the script would otherwise find the repository being
# committed to rather than the checkout it was run in, and digest that one's
# index.
image() { # subcommand track...
	: >"$STUB_LOG"
	(
		cd "$RUN_DIR" || exit 1
		env -u GIT_DIR -u GIT_WORK_TREE -u GIT_INDEX_FILE -u GIT_PREFIX \
			-u GIT_OBJECT_DIRECTORY -u GIT_ALTERNATE_OBJECT_DIRECTORIES \
			-u GIT_CEILING_DIRECTORIES \
			PATH="$stubs:$PATH" \
			STUB_LOG="$STUB_LOG" \
			STUB_INSPECT="$STUB_INSPECT" \
			STUB_CREATE_STATUS="$STUB_CREATE_STATUS" \
			STUB_BUILD_STATUS="$STUB_BUILD_STATUS" \
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

git_checkout() { # arguments...
	env -u GIT_DIR -u GIT_WORK_TREE -u GIT_INDEX_FILE -u GIT_PREFIX \
		-u GIT_OBJECT_DIRECTORY -u GIT_ALTERNATE_OBJECT_DIRECTORIES \
		-u GIT_CEILING_DIRECTORIES \
		git -C "$CHECKOUT" "$@"
}

# The tag the checkout names for a track. It is read inside a command
# substitution, so it prints what the run printed and judges nothing: a run that
# failed prints no tag, and every comparison below it then says so.
tag_of() { # track
	image tag "$1"
	printf '%s\n' "$out"
}

tags_of() {
	local track
	for track in "${TRACKS[@]}"; do
		printf '%s=%s\n' "$track" "$(tag_of "$track")"
	done
}

# Rewrites a file of the checkout and stages it, as a commit to it would have.
# The digest reads what git has staged rather than the working tree, so a change
# the index does not carry is a change the next run cannot see.
stage() { # path text
	printf '%s' "$2" >"$CHECKOUT/$1"
	git_checkout add -- "$1" >/dev/null
}

# A checkout of the two scripts, the Dockerfiles and the compose file, with a
# placeholder for every other path the script says an image is built from. Which
# paths those are is asked of the script rather than written down again, so a
# track that grows an input grows one here too.
fresh_checkout() {
	rm -rf "$CHECKOUT"
	mkdir -p "$CHECKOUT"
	git_checkout init --quiet >/dev/null

	local relative track name
	for relative in "${COPIED[@]}"; do
		mkdir -p "$CHECKOUT/$(dirname "$relative")"
		cp "$REPO_ROOT/$relative" "$CHECKOUT/$relative"
	done
	mkdir -p "$CHECKOUT/ci/images"
	for track in "${TRACKS[@]}"; do
		cp "$REPO_ROOT/ci/images/${track}.Dockerfile" "$CHECKOUT/ci/images/${track}.Dockerfile"
	done

	for track in "${TRACKS[@]}"; do
		image inputs "$track"
		while read -r name; do
			[ -n "$name" ] || continue
			if [ -e "$CHECKOUT/$name" ]; then
				continue
			fi
			if [ -d "$REPO_ROOT/$name" ]; then
				mkdir -p "$CHECKOUT/$name"
				printf '# a placeholder for %s\n' "$name" >"$CHECKOUT/$name/install.sh"
			else
				mkdir -p "$CHECKOUT/$(dirname "$name")"
				printf '# a placeholder for %s\n' "$name" >"$CHECKOUT/$name"
			fi
		done <<<"$out"
	done

	printf 'A file no image is built from.\n' >"$CHECKOUT/README.md"
	git_checkout add --all >/dev/null
}

fresh_checkout

echo "--- the reference a pipeline pins ---"

for track in "${TRACKS[@]}"; do
	repository="$REGISTRY/ubuntu-the-test-cabinet-${track}-cicd"
	expected="$repository:$(tag_of "$track")"
	image reference "$track"
	check_equal "the $track reference is the repository and the tag" "$expected" "$out"
	check_contains "the $track reference opens with the registry" "$REGISTRY/" "$out"
	if [[ "$(tag_of "$track")" =~ ^v1-[0-9a-f]{12}$ ]]; then
		ok "the $track tag is the schema segment and twelve hex digits"
	else
		bad "the $track tag is the schema segment and twelve hex digits" "got: $(tag_of "$track")"
	fi
done

# A `docker image ls` and the registry's own listing say which track an image
# belongs to without reading its tag.
repositories=""
for track in "${TRACKS[@]}"; do
	image reference "$track"
	repositories+="${out%%:*}"$'\n'
done
check_equal "each track is pushed to a repository of its own" \
	"${#TRACKS[@]}" "$(sort -u <<<"$repositories" | grep -c .)"

echo "--- the tags file the pipeline includes ---"

# `tag` given no track writes every track's tag into the variables template
# azure-pipelines.yml includes, under the header the render writes it with, so
# the first run of it changes the placeholders and nothing else.
expected="$(sed '/^variables:$/q' "$REPO_ROOT/$TAGS_FILE")"
for track in "${TRACKS[@]}"; do
	expected+=$'\n'"  ${track}ImageTag: $(tag_of "$track")"
done
image tag
status=$?
check_equal "writing the tags file exits 0" 0 "$status"
check_equal "the tags file is the render's header and every track's tag" "$expected" "$(cat "$CHECKOUT/$TAGS_FILE")"
for track in "${TRACKS[@]}"; do
	check_contains "it prints the $track tag it wrote" "${track}ImageTag: $(tag_of "$track")" "$out"
done
check_contains "it says what to do with the file" "Commit it" "$out"
check_empty "it reaches no docker" "$log"

# The file is no input of any image, so committing it retires none.
before="$(tags_of)"
git_checkout add -- "$TAGS_FILE" >/dev/null
check_equal "committing the tags file moves no tag" "$before" "$(tags_of)"

# A tag that cannot be computed leaves the file as it was, rather than a file
# holding some tracks' tags and not the others'.
printf 'variables:\n  rustImageTag: v1-000000000000\n' >"$CHECKOUT/$TAGS_FILE"
git_checkout rm --cached --quiet -- ci/images/web.Dockerfile >/dev/null
image tag
status=$?
git_checkout add -- ci/images/web.Dockerfile >/dev/null
check_equal "a tag that cannot be computed fails the write" 1 "$status"
check_equal "and leaves the tags file as it was" \
	"$(printf 'variables:\n  rustImageTag: v1-000000000000')" "$(cat "$CHECKOUT/$TAGS_FILE")"
check_contains "and says so" "$TAGS_FILE is left as it was" "$err"
check_empty "and leaves nothing half written beside it" \
	"$(find "$CHECKOUT/ci/images" -name 'tags.yml.*')"
git_checkout checkout -- "$TAGS_FILE"

echo "--- a tag the registry already holds ---"

for track in "${TRACKS[@]}"; do
	image reference "$track"
	reference="$out"
	STUB_INSPECT=present
	image build "$track"
	status=$?
	STUB_INSPECT=absent
	check_equal "the $track build exits 0" 0 "$status"
	check_contains "it says the $track image is already there" "already in the registry" "$out"
	check_absent "it pushes no $track image" "Pushed" "$out"
	check_equal "it does nothing but look the $track tag up" \
		"docker: buildx imagetools inspect $reference" "$log"
done

echo "--- a tag the registry does not hold ---"

for track in "${TRACKS[@]}"; do
	image reference "$track"
	reference="$out"
	repository="${reference%%:*}"
	pins "$track"
	build_args=""
	while read -r pin; do
		[ -n "$pin" ] || continue
		build_args+=" --build-arg $pin"
	done <<<"$out"
	cache="type=registry,ref=${repository}-cache:latest"

	image build "$track"
	status=$?
	check_equal "the $track build exits 0" 0 "$status"
	check_contains "it says the $track tag is absent" "is not in the registry" "$out"
	check_contains "it reports the $track push" "Pushed $reference" "$out"
	check_contains "it creates the builder" \
		"docker: buildx create --name $BUILDER --driver docker-container --use" "$log"
	check_contains "the $track builder is handed the pins, the file and the caches" \
		"docker: buildx build --platform linux/amd64 --file ci/images/${track}.Dockerfile --tag ${reference}${build_args} --cache-from ${cache} --cache-to ${cache},mode=max --push ." \
		"$log"
	check_absent "the $track build signs in to no registry itself" "login" "$log"
done

echo "--- the build arguments are the pins the anchor decides ---"

pins rust
check_contains "the rust image is built with the compiler the anchor pins" \
	"RUST_VERSION=$(sed -n 's/^ *RUST_VERSION: *//p' "$CHECKOUT/$COMPOSE")" "$out"
check_contains "the rust image is built with the test runner the anchor pins" \
	"NEXTEST_VERSION=$(sed -n 's/^ *NEXTEST_VERSION: *//p' "$CHECKOUT/$COMPOSE")" "$out"
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

echo "--- the builder and a build that fails ---"

# A job retried on an agent it has run on before finds the builder in place.
STUB_CREATE_STATUS=1
image build rust
status=$?
STUB_CREATE_STATUS=0
check_equal "a builder that is already there is used rather than recreated" 0 "$status"
check_contains "it is selected instead" "docker: buildx use $BUILDER" "$log"
check_contains "and the build still runs" "docker: buildx build" "$log"

# `set -e` has to survive the function call, and a red push must not print
# `Pushed`.
STUB_BUILD_STATUS=1
image build rust
status=$?
STUB_BUILD_STATUS=0
check_equal "a build that fails fails the run" 1 "$status"
check_absent "a build that failed reports no push" "Pushed" "$out"

echo "--- a registry that cannot answer ---"

# The check has to err in one direction or the other, because an absent tag and
# a registry that cannot answer are the same exit status. Reading a failure as
# "the image is there" would skip a build the gates pipeline is waiting on and
# leave it pulling a tag nothing pushed, which no later step recovers from.
# Reading it as "not there" costs a build that then fails at `--push`, with the
# real reason in the log.
STUB_INSPECT=unreachable
image build rust
status=$?
STUB_INSPECT=absent
check_equal "a registry query that fails outright still builds" 0 "$status"
check_absent "it is not read as a skip" "already in the registry" "$out"
check_contains "it pushes" "--push ." "$log"

echo "--- the guards ---"

for subcommand in inputs tag reference build; do
	image "$subcommand" bogus
	status=$?
	check_equal "\`$subcommand bogus\` fails" 1 "$status"
	check_contains "\`$subcommand bogus\` names the track" "unknown track 'bogus'" "$err"
	check_empty "\`$subcommand bogus\` prints nothing a caller could read as an answer" "$out"
	check_empty "\`$subcommand bogus\` reaches no docker" "$log"
done

image
status=$?
check_equal "no arguments fails" 1 "$status"
check_contains "no arguments prints the usage" "usage: scripts/ci/ci-image.sh" "$err"
check_empty "no arguments prints nothing on stdout" "$out"

image tag rust extra
status=$?
check_equal "too many arguments fails" 1 "$status"
check_contains "too many arguments prints the usage" "usage: scripts/ci/ci-image.sh" "$err"

image publish rust
status=$?
check_equal "an unknown subcommand fails" 1 "$status"
check_contains "an unknown subcommand prints the usage" "usage: scripts/ci/ci-image.sh" "$err"
check_empty "an unknown subcommand reaches no docker" "$log"

# Every path the script names is relative to the root — the input list, the
# Dockerfile, the build context and ci/images/build-args.sh — so a run from
# anywhere else would resolve none of them.
before_tag="$(tag_of web)"
RUN_DIR="$CHECKOUT/ci/images"
image reference web
RUN_DIR="$CHECKOUT"
check_contains "a run from below the root acts on the same files" "$before_tag" "$out"

echo "--- the tag ---"

check_equal "the same checkout always names the same tag" "$(tags_of)" "$(tags_of)"

# An input git has never seen contributes nothing to the digest, so a tag
# computed over a half-staged checkout is a tag no committed checkout ever names
# again. `--error-unmatch` is what turns that into git's own message.
git_checkout rm --cached --quiet -- .devcontainer/tools/uv.sh >/dev/null
image tag rust
status=$?
check_equal "an input that is not in the index fails" 1 "$status"
check_empty "it prints no tag beside the error that says it is wrong" "$out"
check_contains "it says which index the input is missing from" "not in git's index" "$err"
git_checkout add -- .devcontainer/tools/uv.sh >/dev/null

# The rust track's own inputs are the rust image's, and nobody else's.
before="$(tags_of)"
printf '# edited, and not staged\n' >"$CHECKOUT/.devcontainer/languages/rust/install.sh"
check_equal "an unstaged edit moves no tag" "$before" "$(tags_of)"
stage .devcontainer/languages/rust/install.sh '# edited, and staged
'
after="$(tags_of)"
check_absent "a change to a rust input moves the rust tag" \
	"$(grep '^rust=' <<<"$before")" "$after"
check_contains "a change to a rust input leaves the web tag alone" \
	"$(grep '^web=' <<<"$before")" "$after"

# uv.sh is installed by the rust and the web image alike, so a change to it
# retires both.
before="$(tags_of)"
stage .devcontainer/tools/uv.sh '# a different uv installer
'
after="$(tags_of)"
check_absent "a change to a shared input moves the rust tag" \
	"$(grep '^rust=' <<<"$before")" "$after"
check_absent "a change to a shared input moves the web tag" \
	"$(grep '^web=' <<<"$before")" "$after"

# Most commits touch none of this, and none of them may retire an image.
before="$(tags_of)"
stage README.md 'A file no image is built from, edited.
'
check_equal "a change no input covers leaves every tag alone" "$before" "$(tags_of)"

# The tag digests the pins an image consumes rather than the file they are
# written in, so bumping the compiler retires the Rust image and leaves the web
# one alone, even though both read the same file.
before="$(tags_of)"
stage "$COMPOSE" "$(sed 's/^  RUST_VERSION: .*/  RUST_VERSION: 9.9.9/' "$CHECKOUT/$COMPOSE")
"
after="$(tags_of)"
check_absent "a bump of a pin the rust image installs moves its tag" \
	"$(grep '^rust=' <<<"$before")" "$after"
check_contains "a bump of a pin the web image ignores leaves it alone" \
	"$(grep '^web=' <<<"$before")" "$after"

# A coding agent's version is bumped often and is in no image.
before="$(tags_of)"
stage "$COMPOSE" "$(sed 's/^  CLAUDE_CODE_VERSION: .*/  CLAUDE_CODE_VERSION: 9.9.9/' "$CHECKOUT/$COMPOSE")
"
check_equal "a bump of a pin no image installs retires nothing" "$before" "$(tags_of)"

# Half a digest is not a tag, and a caller reads stdout and would write it down.
printf 'services:\n  dev: {}\n' >"$CHECKOUT/$COMPOSE"
image tag rust
status=$?
check_equal "pins that cannot be read name no tag" 1 "$status"
check_empty "and print no tag" "$out"
check_contains "and say which reader failed" "build-args.sh rust failed" "$err"

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
