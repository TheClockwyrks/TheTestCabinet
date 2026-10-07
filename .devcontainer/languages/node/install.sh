#!/usr/bin/env bash
# Installs Node + NPM. The web app, the documentation site, the prose gates,
# Prettier and the Codex CLI all rely on it.
set -euo pipefail

# Node's name for this architecture. Read out of the image rather than
# passed in as a build arg — see "Architecture" in .devcontainer/README.md.
arch="$(dpkg --print-architecture)"
case "$arch" in
	amd64) readonly NODE_ARCH="x64" ;;
	arm64) readonly NODE_ARCH="arm64" ;;
	*)
		echo "node/install.sh: unsupported architecture '$arch'" >&2
		exit 1
		;;
esac

# See https://nodejs.org/en/download for the download URLs.
readonly ARCHIVE_NAME="node-v${NODE_VERSION}-linux-${NODE_ARCH}.tar.xz"
readonly DOWNLOAD_URL="https://nodejs.org/dist/v$NODE_VERSION/$ARCHIVE_NAME"

# The tarball is unpacked and thrown away, so it goes wherever this environment
# says scratch files go, which is /tmp unless something says otherwise.
readonly WORK_DIR="${TMPDIR:-/tmp}"
readonly TAR_PATH="$WORK_DIR/node.tar.xz"

# Where Node is unpacked and where its three commands are linked. The
# devcontainer takes the defaults, the container user's home and the bin
# directory the Dockerfile already puts on the PATH. The CI images under
# ci/images/ override both to /usr/local, having no container user whose home
# directory they could use and no certainty about which user their steps run as.
if [ -z "${NODE_INSTALL_DIR:-}" ]; then
	: "${USERNAME:?USERNAME must be set when NODE_INSTALL_DIR is not}"
	NODE_INSTALL_DIR="/home/$USERNAME/node/$NODE_VERSION"
fi
readonly INSTALL_PATH="$NODE_INSTALL_DIR"
readonly BIN_PATH="${NODE_BIN_DIR:-$HOME/.local/bin}"

mkdir -p "$WORK_DIR" "$BIN_PATH"
wget -O "$TAR_PATH" "$DOWNLOAD_URL"
mkdir -p "$INSTALL_PATH"
# Remove the top-level directory when untarring so symlinks stay stable.
tar -xf "$TAR_PATH" -C "$INSTALL_PATH" --strip-components=1

ln -sf "$INSTALL_PATH/bin/node" "$BIN_PATH/node"
ln -sf "$INSTALL_PATH/bin/npm" "$BIN_PATH/npm"
ln -sf "$INSTALL_PATH/bin/npx" "$BIN_PATH/npx"

# Run it once, here. A tarball for the wrong architecture unpacks and links
# without complaint, and nothing else in the image build executes node: the next
# thing that does is `npm`, whose `#!/usr/bin/env node` shebang leaves the failed
# exec to glibc, which retries the ELF as a shell script and reports it as
#
#   /home/<user>/.local/bin/node: 1: Syntax error: ")" unexpected
#
# naming neither this script nor an architecture, minutes after the download that
# caused it. See "Architecture" in .devcontainer/README.md.
if ! "$BIN_PATH/node" --version >/dev/null 2>&1; then
	echo "node/install.sh: $ARCHIVE_NAME does not run in this image" >&2
	echo "  dpkg --print-architecture: $arch; uname -m: $(uname -m)" >&2
	exit 1
fi

# The full Node distribution is on the PATH too, not just the three commands
# linked above, so an interactive shell reaches the rest of what it ships. Only
# where there is an rc file to append to: a CI image has none, wants none, and
# reaches every command through the image's own PATH instead.
readonly PATH_LINE="export PATH=\$PATH:$INSTALL_PATH/bin"

if [ -f "$HOME/.bashrc" ] && ! grep -Fqx "$PATH_LINE" "$HOME/.bashrc"; then
	echo "$PATH_LINE" >> "$HOME/.bashrc"
fi
