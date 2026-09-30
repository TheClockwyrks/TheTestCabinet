#!/usr/bin/env bash
# Runs once, when the workspace's devcontainer is created.
#
# It installs the git hook and the npm workspace's dependencies. The gates
# themselves are committed scripts, so a clone runs the same checks whatever the
# container carries; the dependencies are what the prose gates, the formatter
# and the documentation site's build run against, and a workspace without them
# has those checks skip themselves. `npm ci` installs exactly the tree
# package-lock.json records, so every workspace of this project gates against
# the same dependency versions.
#
# The hook is installed by scripts/setup-hooks.sh, the same command a clone
# outside the container runs. The image carries pre-commit and npm, so neither
# is looked for before it is used. A container whose creation fails here is one
# whose commits would not be gated, which is worth hearing about while the
# container is created rather than at the first commit.
#
# The one thing looked for is the repository itself. A workspace rendered by
# hand is a plain directory until `git init` makes it one, and a directory with
# no repository has no commits for the hook to gate, so the install is skipped
# and said to be skipped rather than failing the creation of a container that is
# otherwise ready to work in.
#
# Between the two, tools/cargo-target.sh places cargo's target directory for
# this checkout and links /cargo-target/the-test-cabinet to it. Where the
# checkout is mounted is a property of the host, known only once the container
# runs, and it does not change between starts, so once at creation is the right
# time. The script never fails, so a checkout it cannot place still gets its
# dependencies. `npm ci` is what gives crates/gg the pinned `typescript` two of
# its catalogues are reflected with; everything else that build needs is in the
# image, so a container is ready to build the workspace when this returns.
set -euo pipefail

if git rev-parse --git-dir >/dev/null 2>&1; then
  bash scripts/setup-hooks.sh
else
  echo "--- the commit hook (skipped: this is not a git repository yet)"
  echo "    run 'git init && bash scripts/setup-hooks.sh' once it is one"
fi

bash .devcontainer/tools/cargo-target.sh

npm ci
