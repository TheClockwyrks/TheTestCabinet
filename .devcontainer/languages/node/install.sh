#!/usr/bin/env bash
# Installs Node + NPM. The TypeScript workspaces (run-record, desktop UI, site)
# and the validator's static build all rely on it.
set -euo pipefail

# The architecture name Node uses in its distribution file names, resolved from the
# machine this runs on rather than passed in.
case "$(uname -m)" in
x86_64) readonly NODE_ARCH="x64" ;;
aarch64 | arm64) readonly NODE_ARCH="arm64" ;;
*)
	echo "error: no Node build for $(uname -m)." >&2
	exit 1
	;;
esac

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
