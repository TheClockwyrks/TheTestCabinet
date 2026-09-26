#!/usr/bin/env bash
# Prints what a job is running as and what it found: the first step of every job
# that runs inside a CI image, so a toolchain question is answered by the log
# rather than by a rebuild.
#
# It also holds the one assumption the Rust image makes about Azure. That image
# installs gg's toolchains under /root and pins HOME=/root (ci/images/README.md);
# Azure runs the job's steps as a user of its own but leaves the image's
# environment in place. If a step ever arrives with another HOME, the reflectors
# in crates/gg/build.rs would look for the toolchains somewhere they are not, and
# the failure would surface minutes later inside a cargo build. So it fails here,
# by name, instead.
set -euo pipefail
# shellcheck source=/dev/null
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

log "who and where"
echo "user: $(id)"
echo "HOME: ${HOME:-<unset>}"
echo "PATH: $PATH"
echo "pwd:  $PWD"
df -h . | tail -1

log "toolchains on PATH"
for tool in rustc cargo cargo-nextest node npm kubectl uv purs ruby ffmpeg; do
	if command -v "$tool" >/dev/null 2>&1; then
		case "$tool" in
			cargo-nextest) printf '%-14s %s\n' "$tool" "$(cargo nextest --version 2>/dev/null | head -1)" ;;
			*) printf '%-14s %s\n' "$tool" "$("$tool" --version 2>/dev/null | head -1)" ;;
		esac
	else
		printf '%-14s (absent)\n' "$tool"
	fi
done

# The Rust image's marker: uv lives beside gg's toolchains under the HOME the
# image was built with. A machine with gg's toolchains elsewhere (a developer's
# container, the Windows agent, the arm64 pool) has no /root/.rustup and is not
# what this guards.
if [[ -d /root/.rustup && ! -x "${HOME:-}/.local/bin/uv" ]]; then
	echo "error: this job runs in the Rust CI image, which installed gg's toolchains under /root," >&2
	echo "       but HOME is '${HOME:-<unset>}', so crates/gg/build.rs would not find them." >&2
	echo "       Azure is expected to leave the image's HOME in place; see ci/images/README.md." >&2
	exit 1
fi
