# Cascade — `v3.0.0`

This is version `v3.0.0` of the **Cascade** test case. The implemented game is an
original Klondike solitaire titled **Cascade**: the classic patience, with seven
tableau columns, four foundations built Ace-to-King by suit, and a stock and a
waste, played entirely with the pointer and finished with a physics-driven
**victory cascade**, where the foundation cards launch one after another, arc
under gravity, bounce off the floor and paint the table on their way off the
sides.

`cascade` is the catalog slug for this lineage and the game's in-fiction title;
Klondike is the public-domain set of solitaire rules it implements. The table,
the card design, the look and the win animation are original to The Test Cabinet,
and no existing product's assets or look are reproduced.

A model is handed a configured TypeScript project and the specification, and
builds the game inside that project. How much of the build the project hands over
depends on the engine the run selects.

## Why this case

Klondike is the solitaire everyone knows, which makes its rules easy to state and
hard to get entirely right. There is no opponent to model and nothing tuned by
feel: every rule is a statement about one of thirteen piles. What the case asks
for is many exact rules holding at once — what each foundation and each column
accepts and refuses, an ordered run that moves as a unit, a stock whose waste
remembers each turn as a set, an auto-move, a card that turns when and only when
it is exposed — driven by a pointer whose grab, drag, drop and double-click rules
are all fixed, and capped by a cascade whose motion is fixed to the figure. A
build that is nearly right in many places is told apart from one that is right.

## Engines

The case supports three engines and seeds a different project for each, which is
what the manifest's `[workspaces]` table is for:

| Engine | What the seeded project supplies |
| --- | --- |
| `none` | The toolchain configuration and `index.html`. There is no `src/`: the build writes the game and the runtime under it, meaning the frame loop and its delta time, the canvas fit, pointer input, audio, the overlay and the `window.__cascade` surface. The surface additionally carries the clock, as `setAutoStep` and `advance`, because nothing outside the build owns it. |
| `simple-2d` | The [Simple 2D](/engines/simple-2d/) package, vendored at seed time, plus `src/constants.ts` and `src/main.ts`. The build writes `src/game.ts`: `CascadeState`, the debug surface `specs/instrumentation.md` specifies, `BACKGROUND`, and the three functions. Its `initialize` returns the surface beside the state as `[state, debug]`, which the engine serves from `engine.debug`. The engine holds the state by value, so a pose on the surface takes the state and returns the next, driven through `engine.apply`. |
| `structured-2d` | The [Structured 2D](/engines/structured-2d/) package, vendored the same way, plus `src/constants.ts` and `src/main.ts`. Its constants also name the level and the actor tags. The build writes `src/game.ts`, which is deliberately absent from the seed: the `GameDefinition`, the game instance whose `initialize` defines the cues and returns the debug surface, the game mode whose `gameStateClass` is the live `CascadeState`, the actors and components the table is drawn by, and `BACKGROUND`. The world is live, so the surface's poses take only their own arguments and act on it at the call. |

Cascade runs in **one** world for the whole session under `structured-2d`: every
screen is a value of the state's `screen` field rather than a level of its own.

The game all three projects describe is the same one, so the review items are the
same under any engine and a score recorded under one is comparable with a score
recorded under another. The specs and the validators branch where the deliverable
differs, and nowhere else.

## The two variants

Cascade ships two variants, and they differ in one thing: how many cards a stock
turn moves.

- `draw-one` (`variants/draw-one.toml`) — the gentler deal. A turn moves one
  card, so every card in the stock is reachable.
- `draw-three` (`variants/draw-three.toml`) — the classic Klondike deal. A turn
  moves three cards, fanned, with only the frontmost playable.

Two seeded specs branch on the variant, `specs/stock.md.hbs` and
`specs/table.md.hbs`, and they branch only over the turn count, the deal-mode id
and label, and the fan. Everything else about the game, the set memory the waste
keeps and the recycle rule included, is common text. The engine workspaces are
per variant because four entries of `src/constants.ts` differ; `workspaces/none/`
holds no game code, so both variants share it.

Neither variant declares a spec of its own, and neither replaces a validator
behind a common review item. Each contributes its own additive items to the
common `stock` category: six on Draw One and ten on Draw Three.

## Contents

| Path | Seeded to a run? | Purpose |
| --- | --- | --- |
| `specs/` | **Yes** | The specification handed to the model, by concern. |
| `workspaces/none/` | **Yes** | The engineless starter project, shared by both variants. |
| `workspaces/<variant>/<engine>/` | **Yes** | The per-engine starter project for that variant. |
| `prompt.hbs` | No | Rendered into the model's prompt; not seeded. |
| `references/<engine>/<variant>/` | No | The authored, correct playable builds, six of them. |
| `showcase/<variant>/` | No | Curated demo media and description for the catalog. |
| `validation/<engine>/` | No | The Vitest validator suite for that engine. |
| `validation-baseline/<engine>/<variant>/` | No | The baseline half of the validation media. |
| `test-case.toml` | No | The manifest: engines, workspaces, specs, domains, review. |
| `variants/` | No | The two variant files. |
| `description.md` | No | The site-facing introduction on the case's detail page. |
| `changelog.md` | No | This version's entry in the case's changelog. |
| `README.md` | No | This overview. |

## The specification

The specification is split across `specs/` by concern, and every file is seeded
for every run. Each rule lives in exactly one file.

| Spec | Covers |
| --- | --- |
| `overview.md` | What is built, which files stay as they are, the stage and the top-left convention, the code quality, the commands run over the finished repository, and the legibility table that is the whole of what the look is held to. |
| `table.md` | The card footprint, the seven column anchors, the top row's stock, waste and foundation anchors, the two overlap offsets, long-column compression, the HUD strip, and sole ownership of every pile's drop rectangle. |
| `deal.md` | The fifty-two-card deck, the shuffle, the seven columns of one to seven cards, the twenty-four-card stock, and what a fresh deal clears. |
| `foundations.md` | What a foundation accepts: an Ace onto an empty slot and the next-higher card of the same suit thereafter, one card at a time, and the pull back onto a legal column. |
| `tableau.md` | What a column accepts: building down in rank and alternating in color, a King onto an empty column, what a grab takes, and the newly exposed card that turns face-up. |
| `stock.md` | The stock, the waste, this build's turn count and deal-mode label, the waste's set memory and the rule it follows, and the recycle. |
| `controls.md` | The pointer: press, drag threshold, drop, the double click, every on-screen control's rectangle, and the overlay key. |
| `victory.md` | The win, the launch cadence and order, the per-frame integration, the floor bounce, the painted trail, and the way out of the win screen. |
| `screens.md` | The four screens, their literal copy, the HUD's three controls, and the deal-mode label. |
| `audio.md` | The ten cues, what each sounds on, and the mute that silences them all. |
| `state.md` | What the game's state carries, in the shape the selected engine holds it in. |
| `instrumentation.md` | The deterministic core, every operation of the debug and automation surface, the four faculty gates, the snapshot shape, the identity rules, and the debug overlay. |
| `showcase.md` | The player-facing description and captured carousel the finished game ships beside its source. |

`deal.md`, `foundations.md`, `tableau.md`, `screens.md` and `victory.md` are
plain Markdown, identical under every engine. `overview.md.hbs`, `table.md.hbs`,
`stock.md.hbs`, `controls.md.hbs`, `audio.md.hbs`, `state.md.hbs`,
`instrumentation.md.hbs` and `showcase.md.hbs` are Handlebars templates rendered
on the engine axis, and `table.md.hbs` and `stock.md.hbs` on the variant axis as
well, before they land. Because the branching resolves at seed time, each seeded
set reads as one self-contained game with no alternative in view.

Under `simple-2d` and `structured-2d`, every figure the specification fixes is
exported from the seeded `src/constants.ts` under the name the specs cite, and
`specs/overview.md` tells the build that constant is the authoritative one. Under
`none` there is no seeded constants module, and each figure is named once in a
module of the build's own.

## Assets and media

This case declares no assets and seeds no `assets/` tree. Every card face, every
card back, the table, the HUD and every screen is drawn in code, which is one
place Cascade is simpler than the cases that ship sprite art.

The case declares no reference mockups and no proof captures either. The media a
reviewer looks at is produced by the validators under `validation/`, from
scenarios the case controls, and the same suites run against each engine's
reference build to produce the baseline it is shown beside.

## What this version fixes about the look

Nothing. `v2.x` wrote a canonical thirteen-color palette and a system-font
requirement into the specification and seeded reference screenshots a build was
compared against; `v3.0.0` seeds none of it. What the specification states is a
legibility table: a face-up card's rank and suit are legible, red and black are
told apart at a glance, a card back reads apart from a card face and from the
table, an empty pile reads as a slot, a held run reads as lifted, a highlighted
target reads as highlighted, and every string is legible against what it sits on.
Everything else about the look is the build's own design, and the `presentation`
validators check presence and distinguishability against a stated RGB distance
rather than a hex value.

## Validation

This case is validator-rated: every point on the checklist carries a Vitest suite,
and the validators decide the functional rating through each point's failure cap.
A reviewer rates the run's aesthetics through the four domains and may override a
verdict.

The checklist is `226` common items across fourteen categories, plus `6` on Draw
One and `10` on Draw Three, so a run carries `232` or `236` points depending on
the deal mode.

`validation/` holds one project per engine, `validation/none/`,
`validation/simple-2d/` and `validation/structured-2d/`, each with a suite per
review point at `<category>/<id>.test.ts`. The `none` suites drive the built site
in headless Chromium through `window.__cascade`, taking the game off real time
with `setAutoStep(false)` and stepping it with `advance`; the two engine projects
run in process against the vendored engine, standing it up over an
`@napi-rs/canvas` canvas and a clock of their own and reaching the surface
through `engine.debug`. The three run the same scenarios and differ only in how
they reach the build.

Every scenario poses a table holding only what its point is about. A fixture
clears the table and adds back exactly the cards the requirement concerns, one
card at a time, and closes the faculty gates that would otherwise intrude: the
automatic flip, win detection, the cascade's launching and the trail's painting.
Every expected value a suite asserts comes from a figure the specs fix, never
from a reference build.

`validation-baseline/<engine>/<variant>/` holds the media the same suites
captured from that engine's reference build, so a reviewer sees the run's
evidence and the reference's side by side.

## Scoring

A run is rated on four domains — `rules` (the deal, the piles, the moves and the
win), `handling` (the pointer that plays them), `cascade` (the signature ending)
and `presentation` (the table's geometry, the screens, the HUD, the overlay and
the audio) — and its overall rating is the worst of the four. Each checklist
point names the domains its failure lowers and how far it lowers them.

## Versioning

This case follows semantic versioning per version folder
(`test-cases/end-to-end/easy/cascade/v3.0.0/`). Each version is self-contained
and immutable once a run references it; design revisions land as new version
folders. `v1.0.0`, `v1.0.1` and `v2.0.0` are frozen.
