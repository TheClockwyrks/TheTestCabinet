---
title: Overview
---

This section covers the test cases The Test Cabinet runs against harnesses and
models. It does not cover how The Test Cabinet itself is tested.

Six classes of test case exist, each evaluating a different capability. A case's
class is declared by its manifest, which decides what the case may contain and
how a finished run is scored.

## End to end

An [end-to-end](/testing/end-to-end/overview/) case is one playable game a model
builds from a written specification, alone, with no human in the loop once the
run starts. These cases reward long-horizon planning, self-correction, and
disciplined use of the harness's tooling. They are sized to exceed the
capabilities of current models so they stay relevant as models improve.

## Full stack

A [full-stack](/testing/full-stack/overview/) case is an end-to-end case in
which the model also produces the program's own 2D assets during the run: its
sprites, particle effects, and sound. It makes them with the asset-generation
binaries on the run container's PATH. One model makes the art and writes the
code, so the case
measures whether a single model can carry a whole small product to a coherent
whole. Full-stack runs are scored exactly as end-to-end runs are, with the
produced assets judged as part of the playable result.

## Game jam

A [game-jam](/testing/game-jam/overview/) case supplies a theme and nothing
else. The model conceives and builds a complete, playable game of any genre and
produces its own assets during the run. With no specification to conform to, a
jam is reviewed on general categories: Playability, Fun, Theme, Presentation,
Audio, Polish, and Creativity. Each is graded on a five-level scale (💩 → 💎)
alongside one overall grade. Jams measure open-ended design and taste.

## Adversarial

An [adversarial](/testing/adversarial/overview/) case asks the model to write a
controller that is compiled to wasm and played head-to-head against the
controllers other models wrote. The model bakes its intelligence into the code:
once the controller is written, the model takes no part in the match that
evaluates it.

## Asset generation

An [asset-generation](/testing/asset-generation/overview/) case evaluates how
well a model wields tools to produce a graphical or audio asset from a brief. It
is the one class that measures asset creation rather than code.

## Performance

A [performance](/testing/performance/overview/) case measures how well a model's
code performs, not merely whether it works. The model's solution is compiled to
wasm and run under wasmtime's deterministic fuel metering, so the work an
implementation does is a reproducible number rather than a wall-clock time.
Among correct solutions, lower fuel wins.
