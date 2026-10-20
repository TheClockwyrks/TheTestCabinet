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
# The second `npm ci`, in the `gg/` checkout, installs gg's own npm workspace,
# which is what gives gg's crates/gg the pinned `typescript` two of its
# catalogues are reflected with; everything else that build needs is in the
# image, so a container is ready to build the workspace and the gg checkout
# when this returns. It is skipped, and said to be, while gg/ is not checked out.
#
# tools/submodule-checkout.sh populates `contracts/` and `engines/`, the
# contracts and engines repositories whose crates and packages the workspace
# builds against, `gg/`, whose crate the patch table names and whose pages the
# documentation site reads, `microservice-dispatcher/`, `microservice-repos/`,
# `tool-model-core/`,
# `tool-paint/`, `tool-particle/`, `tool-sprite/`, `tool-voxel/`, `tool-mc/`,
# `tool-sn/`, `tool-dc/`, `tool-audio-core/`, `tool-sfx-synth/`,
# `tool-sfx-sample/` and `tool-music/`, whose crates the patch table names,
# `test-suites/`, the suites checkout The Test Cabinet ingests from, and
# `ui-common/`, the ui-common repository whose packages the web front ends build
# against. It names those nineteen alone, because cold-storage beside them is
# optional and about 2 GB. It runs ahead of `npm ci`, which lists contracts', engines' and
# ui-common's packages in the npm workspace, and after tools/ssh-agent.sh,
# because the clone goes through the host agent that script publishes: this runs
# before post-start.sh, so the agent is published here first (the script is
# idempotent, and post-start.sh publishes it again). The checkout pins Azure
# DevOps' host key so the first clone stops at no prompt, is a no-op when the
# host clone the checkout is mounted from already populated it, and says a
# failure rather than failing the creation of a container that is otherwise
# ready; a host with no agent to publish is one such failure, said by the agent
# script and held here, so the submodules are checked out at the next start, or
# by hand, once SSH works.
set -euo pipefail

if git rev-parse --git-dir >/dev/null 2>&1; then
  bash .devcontainer/tools/ssh-agent.sh || true
  bash .devcontainer/tools/submodule-checkout.sh || true
  bash scripts/setup-hooks.sh
else
  echo "--- the commit hook (skipped: this is not a git repository yet)"
  echo "    run 'git init && bash scripts/setup-hooks.sh' once it is one"
fi

npm ci

if [ -f gg/package.json ]; then
  npm ci --prefix gg
else
  echo "--- gg's npm workspace (skipped: gg/ is not checked out)"
  echo "    run 'npm ci --prefix gg' once it is"
fi
