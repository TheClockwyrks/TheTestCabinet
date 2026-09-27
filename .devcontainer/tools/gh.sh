#!/usr/bin/env bash
# Installs the GitHub CLI (`gh`), which is how a repository hosted on GitHub is
# driven from in here: pull requests, issues, and the runs of whatever Actions
# workflows it carries. It sits beside tools/az.sh because a project's remote is
# on one forge or the other, and a container that carries both reaches whichever
# this project turned out to use. Authenticate once with `gh auth login`.
#
# `gh` is not a toolchain the pipeline names, so it carries no build argument
# and the version is pinned below, in the script that installs it, which is
# where .devcontainer/README.md puts a tool without one. It ships as a single
# static binary per platform, installed into ~/.local/bin (already on PATH per
# the Dockerfile). This runs at container build time and is safe to re-run by
# hand after a rebuild.
set -euo pipefail

# See https://github.com/cli/cli/releases for the download URLs.
readonly GH_VERSION="2.101.0"

# gh's name for this architecture is the one dpkg uses. Read out of the image
# rather than passed in as a build arg — see "Architecture" in
# .devcontainer/README.md.
arch="$(dpkg --print-architecture)"
case "$arch" in
	amd64 | arm64) readonly ARCH="$arch" ;;
	*)
		echo "gh.sh: unsupported architecture '$arch'" >&2
		exit 1
		;;
esac

readonly BIN_DIR="$HOME/.local/bin"
mkdir -p "$BIN_DIR"

# The archive holds one `gh_<version>_linux_<arch>/` directory, and the binary
# under its bin/ is all that is taken from it.
readonly ARCHIVE_DIR="gh_${GH_VERSION}_linux_${ARCH}"
wget -O - "https://github.com/cli/cli/releases/download/v${GH_VERSION}/${ARCHIVE_DIR}.tar.gz" \
	| tar -xz -C "$BIN_DIR" --strip-components=2 "${ARCHIVE_DIR}/bin/gh"
chmod +x "$BIN_DIR/gh"

# Run it once, so an artifact for the wrong architecture fails the image build
# rather than a person's first command. See "Architecture" in
# .devcontainer/README.md.
if ! "$BIN_DIR/gh" --version >/dev/null 2>&1; then
	echo "gh.sh: ${ARCHIVE_DIR} does not run in this image" >&2
	echo "  dpkg --print-architecture: $arch; uname -m: $(uname -m)" >&2
	exit 1
fi

echo "Installed gh ${GH_VERSION}"
