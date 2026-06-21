---
title: Overview
---

An **asset-generation** test case evaluates how well a model can use tools to
**produce a graphical asset** rather than to write a program. Initially this means
**2D work** — creating a sprite — and it is a deliberately different class of test
from the others: it does not measure code generation at all, it measures how well
a model can drive a drawing tool toward a goal **described in a brief** through
many small, deliberate steps. The result is **subjective** — the model is given a
precise written description and the freedom to draw something that matches it, so
the case rewards creativity rather than the faithful reproduction of a supplied
picture. There is **no target image** the model copies and no automated
similarity score; a published run carries a human [review](/components/core/results/#reviews)
of how convincingly the asset realizes the brief.

The [other test types](/testing/overview/) reward writing code that builds or
competes. Asset generation isolates a capability those cases deliberately design
*around* — [end-to-end](/testing/end-to-end/overview/) cases pre-provide assets so
that runs stay comparable and the test stays about software development. Here the
asset *is* the task.

## How it works

The model is given an **isolated environment** containing a **drawing binary** it
can call. The binary is the only way to make a mark: it exposes a set of editing
operations — brushes and other image mutations, as ordinary CLI subcommands — and
the model produces the asset by **calling the binary repeatedly**, one operation
at a time, until it decides the image is finished and returns. The binary's
`--help` is the contract (a case seeds no operations schema); see
[The drawing binaries](/testing/asset-generation/draw-tool/).

Two properties make this work as a benchmark:

- **The model can see its progress.** The binary renders the **actual image** at
  each step and writes it out, so the model can read a real image file to observe
  what it has drawn so far and decide what to do next. The binary does not need to
  keep *old* images — only the current one — so the model always sees the latest
  state without the environment accumulating history.
- **Every operation is recorded.** The binary records **all** the tool calls the
  model makes and returns that record to The Test Cabinet. The record — the
  ordered list of operations — is the real output of the run, not the pixels the
  model happened to have on disk when it stopped.

## Why the actions are the output

The image the model produced **cannot be trusted** as the result. A model could
sidestep the drawing tools entirely — writing code that emits an image file
directly — and a benchmark that scored those pixels would be measuring the wrong
thing. The Test Cabinet therefore treats the **recorded actions** as
authoritative and **regenerates** the image from them:

- The test harness replays the recorded operations through the **same drawing
  logic** the binary used and takes the **regenerated image** as the test output.
  Because the regeneration runs the same operations the model actually issued, an
  image produced by any means other than those operations simply does not exist in
  the result.
- Comparing the regenerated image against the **final image from the model's
  run** is itself a useful signal: if the two diverge, the model drew outside the
  recorded operations — a sign it tried to cheat by editing the image directly.
  See [Evaluation](/testing/asset-generation/evaluation/).

This regenerate-from-actions design is the asset-generation analogue of the
[adversarial sandbox](/testing/adversarial/overview/#the-controller-contract): in
both, the model is held to a constrained channel — a controller contract there, a
drawing tool here — and anything produced outside that channel is discarded rather
than scored.

## Single sprites and sprite sheets

A case declares, with its `asset_kind`, whether the model draws a **single
sprite** (one image on the whole canvas — the default) or a **sprite sheet** (a
set of animation frames). A sprite sheet's frames are **completely separate
files** — each its own canvas, drawn with the [`draw-sheet`
binary](/testing/asset-generation/draw-tool/) and a required `--frame <index>` —
not regions of one larger image. A sprite-sheet case adds a `[sheet]` table that
declares its **frames** (each by the index it is written to) and the **animation
sequences** — ordered lists of frame indices, each with a playback rate — so the
review UI can play the named animations back from the per-frame regenerated images
and a reviewer can judge a sheet by its motion, not just its static pixels. The
shape is a property of the whole version, not a variant: a case is either a single
sprite or a sprite sheet. Neither carries a target image: a single sprite's one
regenerated image and a sprite sheet's per-frame regenerated images are reviewed
against the brief.

See [The drawing binaries](/testing/asset-generation/draw-tool/) for how the model
draws, and [Manifests](/testing/asset-generation/manifests/) for how a case
declares its canvas, `asset_kind`, and the `[sheet]` frames and sequences.
