#!/usr/bin/env bash
# Installs the GitHub CLI (`gh`), which `tcab publish` shells out to in order to
# create and push per-run repositories and configure GitHub Pages.
#
# `gh` is NOT part of the base devcontainer image. Run this script once after the
# container is created (and again after a rebuild) to install it into
# ~/.local/bin. Authenticate separately with `gh auth login` or a GH_TOKEN that
# carries the `repo` and `workflow` scopes.
set -euo pipefail

# gh publishes Linux archives for amd64 and arm64; map the Debian architecture
# name onto the one gh uses in its asset file names.
case "$(dpkg --print-architecture)" in
	amd64) readonly GH_ARCH="amd64" ;;
	arm64) readonly GH_ARCH="arm64" ;;
	*)
		echo "Unsupported architecture: $(dpkg --print-architecture)" >&2
		exit 1
		;;
esac

# Resolve the latest stable release tag rather than pinning, so a fresh install
# tracks upstream. The tag looks like `v2.94.0`; strip the leading `v`. Read the
# whole API response into a variable first, then parse it: piping curl into a
# parser that exits early (grep -m1, awk's exit) closes the pipe and makes curl
# fail with EPIPE, which `pipefail` would turn into a script abort.
readonly LATEST_URL="https://api.github.com/repos/cli/cli/releases/latest"
latest_json="$(curl -fsSL "$LATEST_URL")"
GH_VERSION="$(awk -F'"' '/"tag_name"/ { sub(/^v/, "", $4); print $4; exit }' <<<"$latest_json")"
readonly GH_VERSION

readonly ARCHIVE_NAME="gh_${GH_VERSION}_linux_${GH_ARCH}.tar.gz"
readonly DOWNLOAD_URL="https://github.com/cli/cli/releases/download/v${GH_VERSION}/${ARCHIVE_NAME}"
readonly INSTALL_PATH="$HOME/.local/share/gh/${GH_VERSION}"
# Stage the download under the install dir rather than /tmp, which can be a small
# tmpfs that cannot hold the archive.
readonly TAR_PATH="$HOME/.local/share/gh/gh.tar.gz"
readonly BIN_PATH="$HOME/.local/bin/gh"

mkdir -p "$INSTALL_PATH" "$HOME/.local/bin"
curl -fsSL -o "$TAR_PATH" "$DOWNLOAD_URL"
# The archive contains a single `gh_<version>_linux_<arch>/` top-level directory;
# strip it so the binary lands directly under the install path.
tar -xzf "$TAR_PATH" -C "$INSTALL_PATH" --strip-components=1
ln -sf "$INSTALL_PATH/bin/gh" "$BIN_PATH"
rm -f "$TAR_PATH"

echo "Installed gh ${GH_VERSION} to ${BIN_PATH}"
