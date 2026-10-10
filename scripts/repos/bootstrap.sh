#!/usr/bin/env bash
# Turn a rendered repository into a pushed one and register it as a submodule.
#
#   scripts/repos/bootstrap.sh <name>
#
# The directory <superrepo>/<name> is what scripts/repos/render.py wrote. This
# script makes it a git repository on `master`, writes the lock files the
# render cannot (an application's Cargo.lock, a workspace's package-lock.json,
# the gate runner's ci/uv.lock),
# commits what it holds, pushes it to the remote of the same name beside the
# superrepo's own, and adds it to the superrepo as a submodule by a relative
# URL, which git resolves against the superrepo's origin, so the file names no
# host.
#
# Every step is skipped when it has already happened: a repository with a
# commit is not committed again, a remote that already holds `master` is not
# pushed, and a submodule already registered is left alone.
#
# TCAB_REMOTE_BASE names the remote the repositories live under; the default
# is the project on Azure DevOps, and a test points it at a directory of bare
# repositories. TCAB_SUPERREPO names the superrepo checkout, for the same
# reason.
set -euo pipefail

SCRIPTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUPERREPO="${TCAB_SUPERREPO:-$(cd "$SCRIPTS_DIR/../.." && pwd)}"
BRANCH="master"
REMOTE_BASE="${TCAB_REMOTE_BASE:-git@ssh.dev.azure.com:v3/genyume/the-test-cabinet}"
RECORD=".test-cabinet-repo.toml"

die() {
	printf 'bootstrap: %s\n' "$*" >&2
	exit 1
}

usage="usage: bootstrap.sh <name>"
[ $# -eq 1 ] || die "$usage"
name="$1"
case "$name" in
*/* | .* | "") die "a repository name is one path segment: $name" ;;
esac

parent="$SUPERREPO"
dir="$parent/$name"
[ -d "$dir" ] || die "$dir does not exist; render it first with scripts/repos/render.py"
[ -f "$dir/$RECORD" ] || die "$dir was not rendered by the kit (no $RECORD)"

# The relative form: the parent superrepo's origin, one directory up, then the
# name. `git submodule add` resolves it against `remote.origin.url` at add
# time and writes the relative form into .gitmodules, so a clone from a mirror
# resolves it against that mirror instead.
[ -n "$(git -C "$parent" config --get remote.origin.url || true)" ] ||
	die "the superrepo at $parent has no origin, which the relative submodule URL resolves against"

if [ ! -d "$dir/.git" ]; then
	git -C "$dir" init -q -b "$BRANCH"
	printf 'bootstrap: initialized %s on %s\n' "$name" "$BRANCH"
fi

# The identity commits are made under. A superrepo checkout sets it in its own
# configuration rather than the account's, so a repository created beside it
# inherits that setting, once, when it has none of its own. Both reads are of
# the repository's own configuration: the account's identity would otherwise
# answer for the new repository and shadow the superrepo's.
for key in user.name user.email; do
	if [ -z "$(git -C "$dir" config --local --get "$key" || true)" ]; then
		value="$(git -C "$SUPERREPO" config --local --get "$key" || true)"
		[ -n "$value" ] && git -C "$dir" config "$key" "$value"
	fi
done

# An application commits its lock file, and its first commit carries the one
# cargo resolves from the public sources its manifests name. The render,
# which touches no network, cannot write it, and a checkout inside the
# superrepo cannot resolve it in place, because the patch table there
# rewrites it; scripts/resolve-lock.sh, which the kit gives every application,
# resolves it in a copy no patch table reaches.
kind="$(sed -n 's/^kind = "\(.*\)"$/\1/p' "$dir/$RECORD")"
if { [ "$kind" = application ] || [ -x "$dir/scripts/resolve-lock.sh" ]; } && [ -f "$dir/Cargo.toml" ] &&
	! git -C "$dir" rev-parse --verify -q HEAD >/dev/null; then
	if [ -x "$dir/scripts/resolve-lock.sh" ]; then
		"$dir/scripts/resolve-lock.sh" --quiet || die "the lock file of $name could not be resolved"
	else
		(cd "$dir" && cargo generate-lockfile --quiet) || die "cargo could not resolve the lock file of $name"
	fi
	printf 'bootstrap: resolved the lock file of %s\n' "$name"
fi

# A kind carrying an npm workspace commits its lock file too, and the
# `typescript` gate installs from it with `npm ci`, which refuses a workspace
# without one. The render cannot write it either, so the first commit carries
# the one npm resolves from the manifest, written without installing anything.
# A workspace already holding one keeps it.
if grep -q '"workspaces"' "$dir/package.json" 2>/dev/null && [ ! -f "$dir/package-lock.json" ] &&
	! git -C "$dir" rev-parse --verify -q HEAD >/dev/null; then
	(cd "$dir" && npm install --package-lock-only --ignore-scripts --no-audit --no-fund --loglevel=error) ||
		die "npm could not write the lock file of $name"
	printf 'bootstrap: wrote the npm lock file of %s\n' "$name"
fi

# The gate runner's uv project commits its lock too, as the superrepo's does:
# the first `uv run --project ci` writes one, and a repository whose scaffold
# lacks it would carry it untracked from its first gate on. The kit renders
# none, since a lock rendered from the template would be stale the moment a
# dependency released, so the first commit carries the one uv resolves.
if [ -f "$dir/ci/pyproject.toml" ] && [ ! -f "$dir/ci/uv.lock" ] &&
	! git -C "$dir" rev-parse --verify -q HEAD >/dev/null; then
	(cd "$dir" && uv lock --quiet --project ci) || die "uv could not write the lock file of ${name}'s ci project"
	printf 'bootstrap: wrote the uv lock file of %s\n' "$name"
fi

if ! git -C "$dir" rev-parse --verify -q HEAD >/dev/null; then
	git -C "$dir" add -A
	git -C "$dir" commit -q -m "chore: scaffold the $name repository"
	printf 'bootstrap: committed the scaffold of %s\n' "$name"
else
	printf 'bootstrap: %s already has a commit\n' "$name"
fi

remote_url="$REMOTE_BASE/$name"
if ! git -C "$dir" remote get-url origin >/dev/null 2>&1; then
	git -C "$dir" remote add origin "$remote_url"
fi

if [ -n "$(git -C "$dir" ls-remote --heads origin "$BRANCH" 2>/dev/null)" ]; then
	printf 'bootstrap: origin already holds %s for %s\n' "$BRANCH" "$name"
else
	git -C "$dir" push -q -u origin "$BRANCH"
	printf 'bootstrap: pushed %s to %s\n' "$name" "$remote_url"
fi

if git -C "$parent" config -f .gitmodules --get "submodule.$name.path" >/dev/null 2>&1; then
	printf 'bootstrap: %s is already a submodule\n' "$name"
else
	git -C "$parent" submodule add -q -b "$BRANCH" "../$name" "$name"
	printf 'bootstrap: added %s as a submodule of the superrepo\n' "$name"
fi
