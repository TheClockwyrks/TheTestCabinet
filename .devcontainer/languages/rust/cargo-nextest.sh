#!/usr/bin/env bash
# Installs cargo-nextest, the repo's Rust test runner (see .config/nextest.toml).
#
# It places the binary nextest publishes for this architecture, taken out of
# the release's archive once the archive's checksum matches the one
# docker-compose.yml pins, and it never builds nextest from source. A source
# build compiles for minutes, and nextest refuses one made without `--locked`,
# so an install that could fall back to one fails the image on the day any
# download before it fails. Downloading the one file the pinned checksum is of,
# from one host in one request, leaves nothing to fall back from: the archive
# arrives and matches, or the build stops here and says which.
set -euo pipefail

# cargo lands in CARGO_HOME, which languages/rust/rustup.sh leaves to the
# caller: the default under the container user's home here, /usr/local/cargo
# in the CI images under ci/images/. nextest is placed in the same bin
# directory, so it lands beside the cargo that runs it.
readonly CARGO_BIN="${CARGO_HOME:-$HOME/.cargo}/bin"
readonly CARGO="$CARGO_BIN/cargo"

if [[ -z "${NEXTEST_VERSION:-}" ]]; then
	echo "cargo-nextest.sh: NEXTEST_VERSION is empty; docker-compose.yml pins it" >&2
	exit 1
fi

# The target triple nextest publishes a binary for on this architecture, and
# the pinned checksum of that triple's archive. Read out of the image rather
# than passed in as a build arg — see "Architecture" in .devcontainer/README.md.
arch="$(dpkg --print-architecture)"
case "$arch" in
	amd64)
		readonly NEXTEST_TARGET_TRIPLE="x86_64-unknown-linux-musl"
		readonly CHECKSUM_VARIABLE="NEXTEST_SHA256_AMD64"
		;;
	arm64)
		readonly NEXTEST_TARGET_TRIPLE="aarch64-unknown-linux-gnu"
		readonly CHECKSUM_VARIABLE="NEXTEST_SHA256_ARM64"
		;;
	*)
		echo "cargo-nextest.sh: unsupported architecture '$arch'" >&2
		exit 1
		;;
esac

expected="${!CHECKSUM_VARIABLE:-}"
if [[ -z "$expected" ]]; then
	echo "cargo-nextest.sh: $CHECKSUM_VARIABLE is empty; docker-compose.yml pins it" >&2
	exit 1
fi

readonly ARCHIVE="cargo-nextest-${NEXTEST_VERSION}-${NEXTEST_TARGET_TRIPLE}.tar.gz"
readonly URL="https://github.com/nextest-rs/nextest/releases/download/cargo-nextest-${NEXTEST_VERSION}/${ARCHIVE}"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

curl -fsSL --proto '=https' --tlsv1.2 --retry 5 --output "$work/$ARCHIVE" "$URL"

# The archive is checked before anything is taken out of it. `sha256sum
# --check` reads the pinned value beside the file's name, and a mismatch is
# stated with both checksums, so a pin bumped without its checksum, or a
# download that is not the release's, says which here.
if ! (cd "$work" && printf '%s  %s\n' "$expected" "$ARCHIVE" | sha256sum --check --quiet --strict -) >/dev/null 2>&1; then
	computed="$(sha256sum "$work/$ARCHIVE" | cut -d' ' -f1)"
	echo "cargo-nextest.sh: $ARCHIVE does not match its pinned checksum" >&2
	echo "  expected ($CHECKSUM_VARIABLE): $expected" >&2
	echo "  computed:                     $computed" >&2
	exit 1
fi

mkdir -p "$CARGO_BIN"
tar --extract --gzip --file "$work/$ARCHIVE" --directory "$work" cargo-nextest
install -m 0755 "$work/cargo-nextest" "$CARGO_BIN/cargo-nextest"

# Run it once. The archive is downloaded and placed without the binary ever
# being executed, so a build for the wrong architecture installs perfectly
# quietly and first fails in `cargo nextest run` — the repo's test gate, a long
# way from here and from anything that mentions an architecture. See
# "Architecture" in .devcontainer/README.md.
if ! "$CARGO" nextest --version >/dev/null 2>&1; then
	echo "cargo-nextest.sh: the $NEXTEST_TARGET_TRIPLE build does not run here" >&2
	echo "  dpkg --print-architecture: $arch; uname -m: $(uname -m)" >&2
	exit 1
fi
