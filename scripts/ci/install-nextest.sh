#!/usr/bin/env bash
# Install cargo-nextest (the repo's Rust test runner; see .config/nextest.toml)
# from its official prebuilt binary. Pinned to NEXTEST_VERSION so CI matches the
# devcontainer (.devcontainer/docker-compose.yml). Cross-platform: the binary
# smoke gate release-tests on Linux and Windows (Azure) and macOS (GitHub), and
# every leg drives this through `bash`, so it detects the platform and fetches
# the matching tarball. Idempotent: a matching version already on PATH (e.g. the
# devcontainer's, or a cache restore) is left as-is.
set -euo pipefail

NEXTEST_VERSION="${NEXTEST_VERSION:-0.9.140}"
CARGO_BIN="${CARGO_HOME:-$HOME/.cargo}/bin"

if command -v cargo-nextest >/dev/null 2>&1 &&
	cargo nextest --version 2>/dev/null | grep -q "$NEXTEST_VERSION"; then
	echo "cargo-nextest $NEXTEST_VERSION already installed"
	exit 0
fi

# Pick the get.nexte.st platform slug for the prebuilt tarball on this agent.
case "$(uname -s)" in
	Linux)
		case "$(uname -m)" in
			aarch64 | arm64) slug="linux-arm" ;;
			*) slug="linux" ;;
		esac
		;;
	Darwin) slug="mac" ;;
	MINGW* | MSYS* | CYGWIN*)
		slug="windows-tar"
		# Azure sets CARGO_HOME from $(Pipeline.Workspace), so it arrives as a
		# Windows path (`D:\a\1/.cargo`). Git bash reads those backslashes as
		# escapes, which makes mkdir and tar target a mangled directory
		# (`D\:\a\001/.cargo/bin`); cygpath rewrites it to a POSIX path.
		CARGO_BIN="$(cygpath -u "$CARGO_BIN")"
		;;
	*)
		echo "install-nextest.sh: unsupported platform $(uname -s)" >&2
		exit 1
		;;
esac

mkdir -p "$CARGO_BIN"
echo "Installing cargo-nextest $NEXTEST_VERSION ($slug) -> $CARGO_BIN"
# get.nexte.st serves a version-pinned, prebuilt tarball holding the
# cargo-nextest binary; extract it straight onto the cargo bin dir.
curl -LsSf "https://get.nexte.st/${NEXTEST_VERSION}/${slug}" | tar zxf - -C "$CARGO_BIN"
cargo nextest --version
