---
format: nyxsis-issue
version: 2
id: m12w5wiiu79bndk4ro5ig45l
zone: REPOS
number: 5
title: Extract the model tools into tool-model-core, tool-voxel, tool-mc, tool-sn and tool-dc
type: generic
state: open
created: 2026-10-13T21:11:52.874606844Z
---

The `model-core`, `voxel-mesh`, `model-skin`, `voxel`, `voxel-anim`, `mc`,
`mc-anim`, `mc-skin`, `sn`, `sn-anim`, `sn-skin`, `dc`, `dc-anim` and
`dc-skin` crates live under the superrepo's `crates/`. The documentation
places the shared libraries in `tool-model-core` and each binary family in
its own `tool` repository depending on it:
`apps/docs/src/content/docs/development/repositories.md`, sections "The
kinds", "The repositories" and "The edges", and the voxel, mesh and skinned
pages under `apps/docs/src/content/docs/testing/asset-generation/`.

## What is missing

The five repositories on Azure, each populated with its crates' history,
rendered by the kit with its gates and pipeline, mirrored to GitHub, with
`tool-voxel`, `tool-mc`, `tool-sn` and `tool-dc` depending on
`tool-model-core` as the "How a dependency is named" section states, and the
driver's image builds pinning each. The crates are removed from the superrepo.

## Verify

`make gate` passes in every new repository and in the superrepo, the
`dependency-graph` gate accepts the new edges, and a voxel, a mesh and a
skinned test case run on the local stack with the binaries the run image
copies.
