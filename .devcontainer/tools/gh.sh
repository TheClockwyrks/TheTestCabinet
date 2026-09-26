#!/usr/bin/env bash
# Installs the GitHub CLI (`gh`), which `tcab publish` shells out to in order to
# create and push per-run repositories and configure GitHub Pages.
#
# `gh` is NOT part of the base devcontainer image. Run this script once after the
# container is created (and again after a rebuild) to install it into
# ~/.local/bin. Authenticate separately with `gh auth login` or a GH_TOKEN that
# carries the `repo` and `workflow` scopes.
#
# THE VERSION IS PINNED, and deliberately so. This script used to resolve the
# latest stable tag at build time from
# https://api.github.com/repos/cli/cli/releases/latest, which made it the only
# step of the image build that depended on the GitHub *API* — every other tool
# here (lazygit, docker, k3d, kubectl, kubelogin, uv, node, rust) is pinned. That
# API is rate-limited per client IP for unauthenticated callers and the image
# build has no token, so the lookup is a request the build cannot retry its way
# out of and cannot cache: a rebuild on a rootless-Podman NixOS host died on
#
#     curl: (22) The requested URL returned error: 404
#
# immediately after the azure-cli layer, with nothing else in the RUN changed.
# The download from github.com itself was never the problem — `lazygit.sh` pulls
# a release asset off github.com earlier in the same RUN and succeeded — so what
# failed was the API call, and an unpinned build that also can't be reproduced
# from one machine to the next is worth nothing here. Bump the pin below when a
# newer `gh` is wanted; `GH_VERSION=2.98.0 bash gh.sh` overrides it for a
# one-off, matching how `uv.sh` pins uv and pre-commit.
set -euo pipefail

# See https://github.com/cli/cli/releases for the available versions.
readonly GH_VERSION="${GH_VERSION:-2.97.0}"

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
