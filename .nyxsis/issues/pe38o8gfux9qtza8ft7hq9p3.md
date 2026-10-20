---
format: nyxsis-issue
version: 3
id: pe38o8gfux9qtza8ft7hq9p3
zone: CICD
number: 3
title: Link the checked-out repositories' packages in the devcontainer's post-create
type: generic
state: open
created: 2026-10-20T06:15:06.755559236Z
---

The documentation states that `.devcontainer/post-create.sh` installs the git
hooks, initializes the submodules a build needs, runs `npm ci` and links the
checked-out repositories' packages:
`apps/docs/src/content/docs/development/running.md`, section "The dev
container".

## What is wrong

`post-create.sh` runs none of `scripts/repos/link-packages.sh`, so a fresh
container resolves a sibling repository's package from the feed rather than
from its checkout until a developer runs the script by hand.

## Verify

After `post-create.sh` runs in a fresh container, `node_modules/@clockwyrks/`
holds the links `link-packages.sh` places for every initialized checkout, and
`shell-tests` passes.
