#!/usr/bin/env bash
# Write the standalone lock file of this application.
#
#   scripts/resolve-lock.sh [cargo generate-lockfile arguments]
#
# An application commits its Cargo.lock as cargo resolves it from the public
# sources its manifests name. A checkout inside the superrepo cannot
# resolve that file in place: the superrepo's .cargo/config.toml carries a
# [patch] table cargo discovers from every directory below it, and the lock
# file it writes there records sibling checkouts instead of revisions. So this
# script copies the sources to a directory no patch table reaches, resolves
# the lock file there, and copies it back. Arguments go to
# `cargo generate-lockfile`, so `--offline` resolves from the local caches.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
[ -f "$root/Cargo.toml" ] || {
	printf 'resolve-lock: no Cargo.toml at %s\n' "$root" >&2
	exit 1
}

scratch="$(mktemp -d "${TMPDIR:-/tmp}/resolve-lock.XXXXXX")"
trap 'rm -rf "$scratch"' EXIT

# The sources and nothing else: not the build output, not the installed
# packages, and not the lock file the patch table wrote.
tar --create --file - --directory "$root" \
	--exclude ./target --exclude ./node_modules --exclude ./.git \
	--exclude ./Cargo.lock --exclude './ci/.venv' . |
	tar --extract --file - --directory "$scratch"

# The copy fetches through the git on PATH, as the repository does, so the
# same SSH agent and URL rewrite serve it; a render older than the kit's
# `.cargo/config.toml` is given the setting here.
mkdir -p "$scratch/.cargo"
[ -f "$scratch/.cargo/config.toml" ] || printf '[net]\ngit-fetch-with-cli = true\n' >"$scratch/.cargo/config.toml"

(cd "$scratch" && cargo generate-lockfile "$@")
cp "$scratch/Cargo.lock" "$root/Cargo.lock"
printf 'resolve-lock: wrote the standalone Cargo.lock\n'
