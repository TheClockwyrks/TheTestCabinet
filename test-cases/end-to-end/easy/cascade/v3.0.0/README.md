# Cascade — `v3.0.0`

This is version `v3.0.0` of the **Cascade** test case. The implemented game is an
original Klondike solitaire titled **Cascade**: the classic patience — seven
tableau columns, four foundations built Ace-to-King by suit, a stock and a waste
— played entirely with the pointer and finished with a physics-driven **victory
cascade**, where the foundation cards launch one after another, arc under
gravity, bounce off the floor and paint the table on their way off the sides.

`cascade` is the catalog slug for this lineage, and the game's in-fiction title;
Klondike is the public-domain set of solitaire rules it implements. The table,
the card design, the look and the win animation are original to The Test Cabinet,
and no existing product's assets or look are reproduced.

A model is handed a configured TypeScript project and the specification, and
builds the game inside that project. How much of the build the project hands over
depends on the engine the run selects.

## Why this case

Klondike is the solitaire everyone knows, which makes its rules easy to state and
hard to get entirely right. There is no opponent to model and nothing tuned by
feel: every rule is a statement about thirteen piles. What the case asks for is
many exact rules holding at once — what each foundation and each column accepts
and refuses, an ordered run that moves as a unit, a stock whose waste remembers
each turn as a set, an auto-move, a card that turns when and only when it is
exposed — driven by a pointer whose grab, drag, drop and double-click rules are
all fixed, and capped by a cascade whose motion is fixed to the figure. A build
that is nearly right in many places is told apart from one that is right.

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
and label, and the fan. Everything else about the game — the set memory the waste
keeps, the recycle rule, and every other rule — is common text. The engine
workspaces are per variant because four entries of `src/constants.ts` differ;
`workspaces/none/` holds no game code, so both variants share it.

## Contents

| Path | Seeded to a run? | Purpose |
| --- | --- | --- |
| `specs/` | **Yes** | The specification handed to the model, by concern. |
| `workspaces/none/` | **Yes** | The engineless starter project, shared by both variants. |
| `workspaces/<variant>/<engine>/` | **Yes** | The per-engine starter project for that variant. |
| `prompt.hbs` | No | Rendered into the model's prompt; not seeded. |
| `references/<engine>/<variant>/` | No | The authored, correct playable builds, six of them. |
| `showcase/<variant>/` | No | Curated demo media, captured from the references. |
| `validation/<engine>/` | No | The Vitest validator suite for that engine. |
| `validation-baseline/<engine>/<variant>/` | No | The baseline half of the validation media. |
| `test-case.toml` | No | The manifest: engines, workspaces, specs, domains, review. |
| `variants/` | No | The two variant files. |
| `description.md`, `changelog.md`, `README.md` | No | Site-facing prose and this overview. |

## What this version fixes about the look

Nothing. `v2.x` wrote a canonical thirteen-colour palette and a system-font
requirement into the specification and seeded reference screenshots a build was
compared against; `v3.0.0` seeds none of it. What the specification states is a
legibility table — a face-up card's rank and suit are legible, red and black are
told apart at a glance, a card back reads apart from a card face and from the
table, an empty pile reads as a slot, a held run reads as lifted, a highlighted
target reads as highlighted, and every string is legible against what it sits on
— and everything else about the look is the build's own design. The
`presentation` validators check presence and distinguishability against a stated
RGB distance, never a hex value.

## Versioning

This case follows semantic versioning per version folder. Each version is
self-contained and immutable once a run references it; design revisions land as
new version folders. `v1.0.0`, `v1.0.1` and `v2.0.0` are frozen.
