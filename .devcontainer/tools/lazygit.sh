#!/usr/bin/env bash
# Installs lazygit, a terminal UI for git (aliased to `gg`).
set -euo pipefail

# lazygit's name for this architecture. Read out of the image rather than
# passed in as a build arg — see "Architecture" in .devcontainer/README.md.
arch="$(dpkg --print-architecture)"
case "$arch" in
	amd64) readonly LAZYGIT_ARCH="x86_64" ;;
	arm64) readonly LAZYGIT_ARCH="arm64" ;;
	*)
		echo "lazygit.sh: unsupported architecture '$arch'" >&2
		exit 1
		;;
esac

# See https://github.com/jesseduffield/lazygit/releases for the download URLs.
readonly ARCHIVE_NAME="lazygit_${LAZYGIT_VERSION}_Linux_${LAZYGIT_ARCH}.tar.gz"
readonly DOWNLOAD_BASE_URL="https://github.com/jesseduffield/lazygit/releases/download/"
readonly TAR_PATH="/tmp/$USERNAME/lazygit.tar.gz"
readonly INSTALL_PATH="/home/$USERNAME/lazygit/$LAZYGIT_VERSION"
readonly BIN_PATH="$HOME/.local/bin/lazygit"

mkdir -p "/tmp/$USERNAME" "$HOME/.local/bin"
wget -O "$TAR_PATH" "$DOWNLOAD_BASE_URL/v$LAZYGIT_VERSION/$ARCHIVE_NAME"
mkdir -p "$INSTALL_PATH"
tar -xzf "$TAR_PATH" -C "$INSTALL_PATH"
ln -sf "$INSTALL_PATH/lazygit" "$BIN_PATH"

# Run it once. Nothing in the image build does, so an artifact for the wrong
# architecture would otherwise install quietly and first fail under a person's
# fingers. See "Architecture" in .devcontainer/README.md.
if ! "$BIN_PATH" --version >/dev/null 2>&1; then
	echo "lazygit.sh: $ARCHIVE_NAME does not run in this image" >&2
	echo "  dpkg --print-architecture: $arch; uname -m: $(uname -m)" >&2
	exit 1
fi
