# A Tree Function On The Files Module

Add an SDK function that returns a workspace tree, in the shape `tree` produces.

## Why

A model opens the workspace by guessing paths. Five of six recorded runs of one
test case spent a turn on a view of `engine/game.md` or `engine/testing.md`,
neither of which exists. The seeded prompt names the `engine` directory without
naming its files, and the failed view aborts the whole program, so the turn is
lost. Those turns were roughly a quarter of the model spend across the six runs.

A depth-limited tree in the opening turn answers the question the guesses were
asking.

## Design

Add the function to the files module on every arm. It takes a root and a depth
bound and returns the tree beneath it.

Apply the workspace's ignore files so a tree does not return `node_modules` or
other ignored directories.

Make its presence in the synthesized opening turn configurable, alongside the
depth the opening call uses, so a run can open holding a shallow tree of the
workspace.

## Done when

- [x] The function exists on every arm and returns a depth-bounded tree.
- [x] Ignored paths are absent from the result.
- [x] The opening turn's inclusion of the call and its depth are configurable.
- [x] Documentation for the function follows the SDK documentation policies.
- [x] Gates green.
