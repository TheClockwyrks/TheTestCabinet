# Deepcore — reference implementation, Simple 2D

> **Status: not yet written.** This directory is declared as this version's
> Simple 2D reference in `variants/base.toml` and is empty. Nothing can be
> validated or captured under `simple-2d` until a build lands here.

The build to write is the same game the other two references implement, on the
Simple 2D engine. `src/game.ts` holds the state and the game's update and
render, and its `initialize` returns `[state, debug]`. `src/constants.ts` and
`src/main.ts` come from `workspaces/simple-2d/` unchanged.

`references/none/` carries v1.0.0's engineless build, which is the closest
starting point on disk: it is not v2.0.0-conformant either, and its own README
lists what the port has to close.

This is a full-stack case, so this reference also owes the produced assets it
loads, committed under its own `assets/`, and `npm ci && npm run build` must
bundle them without invoking the asset tools.
