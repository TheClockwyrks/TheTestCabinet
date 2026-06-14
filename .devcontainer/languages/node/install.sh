#!/usr/bin/env bash
# Installs Node + NPM. The TypeScript workspaces (run-record, desktop UI, site)
# and the validator's static build all rely on it.
set -euo pipefail

# Determine the architecture name that Node uses for the current platform.
if [ "$BUILDARCH" = "amd64" ]; then
	readonly NODE_ARCH="x64"
else
	readonly NODE_ARCH="arm64"
fi

# See https://nodejs.org/en/download for the download URLs.
readonly ARCHIVE_NAME="node-v${NODE_VERSION}-linux-${NODE_ARCH}.tar.xz"
readonly DOWNLOAD_URL="https://nodejs.org/dist/v$NODE_VERSION/$ARCHIVE_NAME"
readonly TAR_PATH="/tmp/$USERNAME/node.tar.xz"
readonly INSTALL_PATH="/home/$USERNAME/node/$NODE_VERSION"
readonly BIN_PATH="$HOME/.local/bin"

mkdir -p "/tmp/$USERNAME" "$BIN_PATH"
wget -O "$TAR_PATH" "$DOWNLOAD_URL"
mkdir -p "$INSTALL_PATH"
# Remove the top-level directory when untarring so symlinks stay stable.
tar -xf "$TAR_PATH" -C "$INSTALL_PATH" --strip-components=1

ln -sf "$INSTALL_PATH/bin/node" "$BIN_PATH/node"
ln -sf "$INSTALL_PATH/bin/npm" "$BIN_PATH/npm"
ln -sf "$INSTALL_PATH/bin/npx" "$BIN_PATH/npx"

if ! grep -Fqx "export PATH=\$PATH:\$HOME/node/$NODE_VERSION/bin" "$HOME/.bashrc"; then
	echo "export PATH=\$PATH:\$HOME/node/$NODE_VERSION/bin" >> "$HOME/.bashrc"
fi
