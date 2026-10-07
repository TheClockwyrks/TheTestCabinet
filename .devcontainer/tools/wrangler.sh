#!/usr/bin/env bash
# Installs wrangler, the Cloudflare CLI `tcab publish` shells out to when it
# deploys a run's playable build to Cloudflare Pages.
#
# Installed with npm, so this runs after languages/node/install.sh. It goes
# into ~/.local rather than into Node's own prefix, because that prefix is on
# the PATH of an interactive shell alone (node/install.sh appends it to
# ~/.bashrc), and a harness session that runs `tcab publish` is started by an
# exec with no shell in between; ~/.local/bin is on the PATH the Dockerfile
# gives every process in the image. The version is the WRANGLER_VERSION build
# argument the compose file's anchor pins, because npm's registry serves the
# current release by default and a rebuild would otherwise pick up whatever
# shipped that week. Credentials are never baked in: authenticate with
# `wrangler login` or a CLOUDFLARE_API_TOKEN in the environment.
set -euo pipefail

: "${WRANGLER_VERSION:?WRANGLER_VERSION must be set}"

readonly PREFIX="$HOME/.local"
readonly BIN_PATH="$PREFIX/bin/wrangler"

mkdir -p "$PREFIX/bin"
npm install -g --prefix "$PREFIX" --no-audit --no-fund "wrangler@${WRANGLER_VERSION}"

# Run it once. wrangler ships a native binary for the platform (workerd), so a
# package resolved for the wrong architecture would install quietly and first
# fail under `tcab publish`. See "Architecture" in .devcontainer/README.md.
if ! "$BIN_PATH" --version >/dev/null 2>&1; then
	echo "wrangler.sh: wrangler ${WRANGLER_VERSION} does not run in this image" >&2
	echo "  dpkg --print-architecture: $(dpkg --print-architecture); uname -m: $(uname -m)" >&2
	exit 1
fi

echo "Installed wrangler $("$BIN_PATH" --version)"
