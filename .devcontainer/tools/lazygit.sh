#!/usr/bin/env bash
# Installs lazygit, a terminal UI for git (aliased to `gg`).
set -euo pipefail

# The architecture name lazygit uses in its release asset file names, resolved from
# the machine this runs on rather than passed in.
case "$(uname -m)" in
x86_64) readonly LAZYGIT_ARCH="x86_64" ;;
aarch64 | arm64) readonly LAZYGIT_ARCH="arm64" ;;
*)
	echo "error: no lazygit build for $(uname -m)." >&2
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
