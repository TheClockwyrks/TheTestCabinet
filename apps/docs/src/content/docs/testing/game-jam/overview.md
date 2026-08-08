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
  _Locomotivation_). The model interprets it however it finds most interesting.
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
directive](/testing/full-stack/overview/#the-standing-quality-directive). It is kept
deliberately minimal: it tells the model that this is a jam, that it may build any
genre, that the two things judged above all are that the game is **playable** and
**enjoyable**, that the jam is a competition scored also on presentation, polish,
theme, audio, and creativity (including assets it must genuinely produce), and that
it should scope the idea so it can finish and polish it. A `====` divider then fences
the directive off from the jam's own brief.

The directive carries no build or tooling detail. Those live in the author's
`prompt.hbs`, which supplies the theme plus the asset-generation binaries, the
build/serve interface, and how to verify and commit — so the model is never pointed
at a "full-stack build" it has no other knowledge of.

Two further standing blocks are appended after the jam's own brief (each fenced by a
`====` divider): the **gameplay README** requirement, always; and, when earlier
entries exist, the **distinctness** section described below. Both are managed in
`crates/core/src/prompt.rs`, not in any jam's `prompt.hbs`.

## The gameplay README

Every jam entry must commit a `README.md` at its project root that, for a *player*,
explains what the game is and how to play it — its premise, goal, controls, and core
loop — with **no** implementation, build, or code detail. This serves two readers:
the person reviewing the entry, and — crucially — a *later* run of the same jam.

## Repeated runs build something distinct

A jam can be run against the same model more than once (whether launched together as
a batch or one at a time, weeks apart). To keep a model from producing near-copies of
the same game, each run is briefed on what earlier runs already built:

- **Capture.** When a jam run finishes, its gameplay README is captured into the run
  record (`RunRecord.gameJamReadme`), so it persists regardless of whether the run is
  ever published.
- **Queue.** A model's runs of one jam are dispatched **one at a time**. The backend
  will not claim a queued `game-jam` job while another run of the same jam and model
  occupies a slot — whichever harness either uses — so a later entry always starts
  after the earlier one has finished and stored its README. Held-back entries show as
  `pending` in the console's active-run list. Runs of *different* jams, or of the same
  jam by different models, are unaffected and still run in parallel.
- **Seed.** Before a new run seeds, the driver asks the backend
  (`GET /game-jams/{slug}/prior-readmes?model=`) for the READMEs of every earlier run
  of the **same jam by the same model** — across every harness, and across all prior
  runs, published or not. Those READMEs are seeded into a `previous-entries/` folder in
  the workspace. The folder is reference material, not part of the submission, so it is
  git-ignored (via `.git/info/exclude`) and never committed — not by the seed, and not
  by the model's own `git add`.
- **Prompt.** When at least one earlier entry was seeded, the prompt gains a
  distinctness section telling the model to read `previous-entries/` and build a
  genuinely different game — a different core idea, genre, or mechanic — rather than a
  reskin or variation.
- **Record.** The entries a run was briefed with are recorded on it as the inputs they
  are (`RunRecord.gameJamPriorEntries` — each earlier run's id, finish time, and the
  README body itself), and the run's **Inputs** tab renders each README inline at the
  `previous-entries/entry-NN.md` path the model read it at, alongside the jam's prompt.
  So what a run was actually shown is readable on the run rather than inferred from the
  games.

The match is on `(jam, model)` and deliberately spans harnesses: what repeats a game
is the model, not the tool driving it, so an entry the same model built under another
harness is exactly the history a new run must not retread. A *different* model's runs
never influence this one. A jam's first run for a given model sees no prior entries and
carries no distinctness section, so it renders exactly as before.

## The two things that are judged

A jam's brief reduces to two words, and they are the bar a reviewer holds the entry
to:

- **Playable** — it loads, runs, and can be played start to finish without
  breaking, and its controls respond. Whether a game has a win or lose condition is
  left to each jam and its design, not required of every entry.
- **Enjoyable** — it is genuinely fun, with a satisfying core loop and a reason to
  keep playing, not a tech demo that merely runs.

Everything else — art, audio, polish, originality — feeds the [graded
review](/testing/game-jam/evaluation/), but these two are the point of the exercise.
