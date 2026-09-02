---
title: Overview
---

A game jam hands the model a theme and asks it to invent and build one complete
game of any genre that is playable and enjoyable, producing the game's own 2D
assets during the run as a [full-stack](/testing/full-stack/overview/) case
does. There is no specification and no reference build to match, so a jam
measures design, scoping, and taste rather than conformance to a brief. Two runs
of the same jam can produce wholly different games and both be excellent.

A jam is not a test case. It lives in its own `game-jams/` folder, is authored
through its own [`game-jam.toml`](/testing/game-jam/manifests/) format, runs in
its own image, and is [graded](/testing/game-jam/evaluation/) on categories
rather than scored against a checklist. Discovery folds the folder into the same
catalog as `test-cases/`, and jams surface in the Other section of the console
and the public gallery.

## Provided material

- A theme: a short brief rendered into the prompt. The model interprets it
  however it finds most interesting.
- A stated time budget. The prompt carries `{{time_limit_hours}}`, derived from
  the case's `max_runtime_hours`, and the container has `date` so the model can
  read the current time and pace itself.
- The same fixed build interface a full-stack case uses. `npm ci && npm run
  build` emits a self-contained static site into `dist/`, `build/`, or `out/`
  that works at any base path.

Resolution rejects `[[spec]]`, `[[reference]]`, and `[[domain]]` tables on a
jam. A jam provides only the theme, and it carries a single overall grade in
place of per-domain ratings.

## The run image

A jam runs in the `test-cabinet-game-jam` image, which a deployment pins with
`TCAB_CONTAINER_IMAGE_GAME_JAM`. The image is built from the
[full-stack-2d image](/testing/full-stack/overview/#the-run-image) and adds no
tooling of its own, so a deployment can pin the jam image on its own while a jam
keeps the same capabilities:

- the six 2D asset-generation binaries on `PATH` (`draw`, `draw-sheet`,
  `particle-2d`, `sfx-synth`, `sfx-sample`, `music`) and the two baked audio
  packs, so a model produces its own art, effects, and sound during the run;
- the Rust, `wasm32-unknown-unknown`, and `wasm-bindgen`/`wasm-pack` toolchain,
  so a model may author its game's core in Rust and ship it as a committed
  `.wasm` build input. The compiled wasm is a build input, so `npm run build`
  bundles it rather than invoking `cargo` or `wasm-pack`.
- `date`, asserted present by the image build, so the model can judge how much
  of its time budget remains.

## The standing game-jam directive

Every jam's prompt is prefixed at render time with a standing directive
(`GAME_JAM_PREAMBLE` in `crates/core/src/prompt.rs`). It stays high level: this
is a jam, any genre is fair game, the design is the model's to invent, the two
things judged above all are that the game is playable and enjoyable, and the
entry competes against other models' entries on presentation, polish, theme,
audio, and creativity, including assets it must genuinely produce. It closes by
telling the model to scope the idea so it can finish and polish it. A divider
fences the directive off from the jam's own brief.

The build and tooling detail lives in the author's `prompt.hbs`, which supplies
the theme, the asset-generation binaries, the build and serve interface, and how
to verify and commit.

Two further standing blocks follow the jam's own brief, each behind a divider:
the gameplay README requirement, always, and the distinctness section when
earlier entries exist. Both are rendered from `crates/core/src/prompt.rs` rather
than from any jam's `prompt.hbs`.

## The gameplay README

Every jam entry commits a `README.md` at its project root that explains to a
player what the game is and how to play it: its premise, goal, controls, and
core loop, in a few short paragraphs, with implementation and build detail left
out. It serves the person reviewing the entry and a later run of the same jam.

When a jam run finishes, that README is captured into the run record
(`RunRecord.gameJamReadme`), so it persists whether or not the run is published.

## Repeat runs

A jam can be run against the same model more than once. Each run is briefed on
what that model's earlier runs of the same jam already built, so a repeat entry
is a different game rather than a reskin.

- A model's runs of one jam are dispatched one at a time. The backend claims no
  queued `game-jam` job while another run of the same jam and model occupies a
  slot, whichever harness either uses, so a later entry starts after the earlier
  one has finished and stored its README. Held-back entries show as `pending` in
  the console's active-run list. Runs of different jams, and runs of the same jam
  by different models, stay parallel.
- Before a new run seeds, the driver asks the backend
  (`GET /game-jams/{slug}/prior-readmes?model=`) for the READMEs of every earlier
  run of the same jam by the same model, across every harness and whether or not
  those runs were published. They are seeded into a `previous-entries/` folder in
  the workspace, oldest first, alongside an index that says what the folder is.
  The folder is reference material, so seeding excludes it from git through
  `.git/info/exclude`, which also keeps the model's own `git add` from
  committing it.
- When at least one earlier entry was seeded, the prompt gains a distinctness
  section telling the model to read `previous-entries/` and build a genuinely
  different game: a different core idea, genre, or central mechanic.
- The entries a run was briefed with are recorded on it as the inputs they were:
  `RunRecord.gameJamPriorEntries` carries each earlier run's id, finish time,
  and the README body itself, and the run's Inputs tab renders each README
  inline at the `previous-entries/entry-NN.md` path the model read it at,
  beside the jam's prompt. What a run was shown is readable on the run rather
  than inferred from the games.

The match is on the jam and the model, and it spans harnesses: what repeats a
game is the model, so an entry the same model built under another harness is
exactly the history a new run must avoid retreading. A different model's runs
never influence this one.

## The judged criteria

- Playable: it loads, runs, and can be played from start to finish without
  breaking, and its controls respond. Whether a game has a win or lose condition
  is left to each jam and its design.
- Enjoyable: it is genuinely fun, with a satisfying core loop and a reason to
  keep playing.

Art, audio, polish, and originality feed the
[graded review](/testing/game-jam/evaluation/). These two decide the result.
