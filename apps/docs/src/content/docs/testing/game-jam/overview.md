---
title: Overview
---

A **game jam** test case is a [full-stack](/testing/full-stack/overview/) case with
its specification removed. Instead of a spec that says what to build and a rubric
that scores conformance, a jam hands the model only a **theme** and asks it to
**invent and build a complete game of any genre** that is *playable* and
*enjoyable*, producing the game's own 2D assets during the run exactly as a
full-stack case does. It is the most open-ended test type: it measures design,
scoping, and taste, not adherence to a specification.

Read the [full-stack overview](/testing/full-stack/overview/) first for the shared
machinery — the build-and-play model and the asset-production capability. This page
covers only what a jam changes; see [Manifests](/testing/game-jam/manifests/) for the
jam's own `game-jam.toml` format and [Evaluation](/testing/game-jam/evaluation/) for
how a jam run is graded. A jam is **not** a test case: it lives in its own
`game-jams/` folder, is authored through a dedicated manifest format (no
`difficulty`, no `variants`), and runs in its own image.

## Why it exists

Every other test type tells the model exactly what to make and grades it on how
closely it matched. That is the right way to measure software development against a
bar, but it says nothing about whether a model can **decide what to build** — frame
a concept, scope it to what it can finish, and make something a person actually
wants to play. A game jam removes the spec so that judgement is the thing under
test. There is no single right answer and no reference build to match; two runs of
the same jam can produce wholly different games and both be excellent.

## What a jam provides — and does not

A jam provides:

- A **theme** — a short, evocative brief rendered into the prompt (for example
  _Dead Man's Switch_). The model interprets it however it finds most interesting.
- A stated **time budget** — the prompt tells the model how many wall-clock hours it
  has (`{{time_limit_hours}}`, from the case's `max_runtime_hours`) and that it can
  run `date` in the container to see the current time and pace itself.
- Its **own run image** (`test-cabinet-game-jam`): the six asset-generation binaries
  on `PATH` (`draw`, `draw-sheet`, `particle-2d`, `sfx-synth`, `sfx-sample`,
  `music`), the base-wasm **Rust → WebAssembly toolchain** (so the model may write
  its core in Rust and ship it as committed wasm, or use plain JS/TS), and `date` —
  see [The game-jam run image](#the-game-jam-run-image).
- The same **fixed build interface** as a full-stack case — `npm ci && npm run
  build` emits a static site into `dist/`/`build/`/`out/`, self-contained, working
  at any base path.

A jam deliberately does **not** provide:

- A **specification** — no `[[spec]]` files are seeded.
- **Reference mockups** — no `[[reference]]` views and no reference-implementation
  "Reference" tab.
- **Scoring domains** — a jam has no `[[domain]]`s; it is graded on general
  categories instead (see Evaluation).

## The game-jam run image

A jam runs in its **own** image, `test-cabinet-game-jam`, rather than borrowing the
full-stack image — because a jam is not a full-stack case, and a dedicated image can
be pinned and evolved on its own (`TCAB_CONTAINER_IMAGE_GAME_JAM`). The image is the
[full-stack-2d image](/testing/full-stack/overview/) given its own identity, so it
carries everything a jam needs:

- the **six 2D asset-generation binaries** on `PATH` and the baked audio packs, so
  the model produces its own art, effects, and sound during the run;
- the base-wasm **Rust + `wasm32-unknown-unknown` + `wasm-bindgen`/`wasm-pack`
  toolchain**, so a model may author its game's core in Rust and ship it as a
  **committed** `.wasm` build input (the compiled wasm is a build input, not a build
  step — `npm run build` must not invoke `cargo`/`wasm-pack`), or use plain JS/TS if
  it prefers; and
- **`date`** (coreutils), so the model can read the current time and judge how much
  of its time budget remains.

## The standing game-jam directive

Every jam's prompt is automatically prefixed at render time with a standing
**game-jam directive** (`GAME_JAM_PREAMBLE` in `crates/core/src/prompt.rs`), the
jam analogue of the [full-stack quality
directive](/testing/full-stack/overview/#the-standing-quality-directive). It tells
the model that this is a jam, that it may build any genre, that the two things
judged above all are that the game is **playable** and **enjoyable**, that it should
scope the idea so it can finish and polish it, and that — like a full-stack build —
it must produce real assets and ship a self-contained build. An author's
`prompt.hbs` therefore carries only the theme and need not restate any of this.

## The two things that are judged

A jam's brief reduces to two words, and they are the bar a reviewer holds the entry
to:

- **Playable** — it loads, runs, and can be played start to finish without
  breaking; controls respond and there is a clear way to win or lose.
- **Enjoyable** — it is genuinely fun, with a satisfying core loop and a reason to
  keep playing, not a tech demo that merely runs.

Everything else — art, audio, polish, originality — feeds the [graded
review](/testing/game-jam/evaluation/), but these two are the point of the exercise.
