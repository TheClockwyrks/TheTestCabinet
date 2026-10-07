#!/usr/bin/env bash
# Installs mold, the linker cargo links this architecture's glibc target with,
# and cc-mold, the driver cargo reaches it through.
#
# A workspace's test build links one binary per crate at once, and mold links
# each in a fraction of the time GNU ld takes, carrying the
# debug info through, so a failed test reports what it did under GNU ld.
#
# cargo is pointed at cc-mold by the image, whose Dockerfile sets
# CARGO_TARGET_X86_64_UNKNOWN_LINUX_GNU_LINKER and
# CARGO_TARGET_AARCH64_UNKNOWN_LINUX_GNU_LINKER, so every process in the image
# links those two targets with mold, and every other target, such as a musl
# one, keeps the linker its own configuration names. The setting is the target's
# linker rather than a flag in its rustflags, which cargo drops whenever
# RUSTFLAGS is set.
#
# It places the binary mold publishes for this architecture, taken out of the
# release's archive once the archive's checksum matches the one
# docker-compose.yml pins.
set -euo pipefail

# cargo lands in CARGO_HOME, which languages/rust/rustup.sh leaves to the
# caller: the default under the container user's home here, /usr/local/cargo
# in the CI images under ci/images/. mold and cc-mold are placed in the same
# bin directory, which every image has on its PATH, so the linker setting names
# cc-mold alone and cc finds `ld.mold` beside it.
readonly CARGO_BIN="${CARGO_HOME:-$HOME/.cargo}/bin"

if [[ -z "${MOLD_VERSION:-}" ]]; then
	echo "mold.sh: MOLD_VERSION is empty; docker-compose.yml pins it" >&2
	exit 1
fi

# The machine name mold publishes a build under on this architecture, and the
# pinned checksum of that build's archive. Read out of the image rather than
# passed in as a build arg — see "Architecture" in .devcontainer/README.md.
arch="$(dpkg --print-architecture)"
case "$arch" in
	amd64)
		readonly MOLD_MACHINE="x86_64"
		readonly CHECKSUM_VARIABLE="MOLD_SHA256_AMD64"
		;;
	arm64)
		readonly MOLD_MACHINE="aarch64"
		readonly CHECKSUM_VARIABLE="MOLD_SHA256_ARM64"
		;;
	*)
		echo "mold.sh: unsupported architecture '$arch'" >&2
		exit 1
		;;
esac

expected="${!CHECKSUM_VARIABLE:-}"
if [[ -z "$expected" ]]; then
	echo "mold.sh: $CHECKSUM_VARIABLE is empty; docker-compose.yml pins it" >&2
	exit 1
fi

readonly RELEASE="mold-${MOLD_VERSION}-${MOLD_MACHINE}-linux"
readonly ARCHIVE="${RELEASE}.tar.gz"
readonly URL="https://github.com/rui314/mold/releases/download/v${MOLD_VERSION}/${ARCHIVE}"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

curl -fsSL --proto '=https' --tlsv1.2 --retry 5 --output "$work/$ARCHIVE" "$URL"

# The archive is checked before anything is taken out of it. `sha256sum
# --check` reads the pinned value beside the file's name, and a mismatch is
# stated with both checksums, so a pin bumped without its checksum, or a
# download that is not the release's, says which here.
if ! (cd "$work" && printf '%s  %s\n' "$expected" "$ARCHIVE" | sha256sum --check --quiet --strict -) >/dev/null 2>&1; then
	computed="$(sha256sum "$work/$ARCHIVE" | cut -d' ' -f1)"
	echo "mold.sh: $ARCHIVE does not match its pinned checksum" >&2
	echo "  expected ($CHECKSUM_VARIABLE): $expected" >&2
	echo "  computed:                  $computed" >&2
	exit 1
fi

# The one binary, and the name `cc -fuse-ld=mold` looks for on the PATH.
mkdir -p "$CARGO_BIN"
tar --extract --gzip --file "$work/$ARCHIVE" --directory "$work" "$RELEASE/bin/mold"
install -m 0755 "$work/$RELEASE/bin/mold" "$CARGO_BIN/mold"
ln -sf mold "$CARGO_BIN/ld.mold"

# The driver cargo is pointed at: the C compiler, which knows the startup
# files and libraries a link takes, told to hand the link to mold.
cat >"$CARGO_BIN/cc-mold" <<'WRAPPER'
#!/bin/sh
exec cc -fuse-ld=mold "$@"
WRAPPER
chmod 0755 "$CARGO_BIN/cc-mold"

# Run both once. A build for the wrong architecture installs perfectly quietly,
# and so does a driver whose compiler finds no `ld.mold`, and either would
# first fail in the link of a gate's first crate. See "Architecture" in
# .devcontainer/README.md.
if ! "$CARGO_BIN/mold" --version >/dev/null 2>&1; then
	echo "mold.sh: the $MOLD_MACHINE build does not run here" >&2
	echo "  dpkg --print-architecture: $arch; uname -m: $(uname -m)" >&2
	exit 1
fi
if ! PATH="$CARGO_BIN:$PATH" "$CARGO_BIN/cc-mold" -Wl,--version 2>/dev/null | grep -q "^mold $MOLD_VERSION "; then
	echo "mold.sh: cc-mold does not link with mold $MOLD_VERSION" >&2
	exit 1
fi
