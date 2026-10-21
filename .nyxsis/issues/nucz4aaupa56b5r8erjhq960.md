---
format: nyxsis-issue
version: 3
id: nucz4aaupa56b5r8erjhq960
zone: REPOS
number: 7
title: Extract the audio tools into tool-audio-core, tool-sfx-synth, tool-sfx-sample and tool-music
type: generic
state: done
created: 2026-10-13T21:12:00.247695391Z
done: 2026-10-20T16:11:40.944092681Z
outcome: |
  tool-audio-core (tagged v0.1.0, recorded in TAGS), tool-sfx-synth,
  tool-sfx-sample and tool-music exist on Azure with their crates' history, kit
  render, protection, pipelines 158-161 and GitHub mirrors, the binaries naming
  audio-core at the tag; the superrepo pins all four as submodules, the driver
  takes audio-core from tool-audio-core, the audio run images copy their binaries
  from the tool images, the containers/tools builder is retired and the four
  crates are removed (PR into nightly; superrepo gates 28/28, each repository
  green). Not verified: an audio case on the local stack; sfx-sample and music
  renders.
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
