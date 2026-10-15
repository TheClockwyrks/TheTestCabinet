---
format: nyxsis-issue
version: 2
id: nucz4aaupa56b5r8erjhq960
zone: REPOS
number: 7
title: Extract the audio tools into tool-audio-core, tool-sfx-synth, tool-sfx-sample and tool-music
type: generic
state: open
created: 2026-10-13T21:12:00.247695391Z
---

The `audio-core`, `sfx-synth`, `sfx-sample` and `music` crates live under the
superrepo's `crates/`. The documentation places the DSP library in
`tool-audio-core` and each binary in its own `tool` repository depending on
it: `apps/docs/src/content/docs/development/repositories.md`, sections "The
kinds", "The repositories" and "The edges", and
`apps/docs/src/content/docs/testing/asset-generation/audio-binaries.md`.

## What is missing

The four repositories on Azure, each populated with its crate's history,
rendered by the kit with its gates and pipeline, mirrored to GitHub, with the
three binaries depending on `tool-audio-core` as the "How a dependency is
named" section states, and the driver's image builds pinning each. The crates
are removed from the superrepo.

## Verify

`make gate` passes in every new repository and in the superrepo, the
`dependency-graph` gate accepts the new edges, and an audio test case runs on
the local stack with the binaries the run image copies.
