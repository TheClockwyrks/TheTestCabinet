# Cascade — `v2.0.0`

This is version `v2.0.0` of the **Cascade** test case. The implemented game is an
original Klondike solitaire titled **Cascade**: the classic patience — seven
tableau columns, four foundations built Ace-to-King by suit, a stock and waste —
finished with a physics-driven **victory cascade** where the foundation cards
bounce off the table and paint the screen.

`cascade` is the catalog slug for this lineage, and the game's in-fiction title
(Klondike is the public-domain set of solitaire rules it implements). The name,
table, card design, palette, and win animation are original; no existing product's
assets or look are reproduced.

## What v2 adds

This version is the instrumented, automatically-validated form of the case:

- The build must expose a `window.__cascade` debugging and automation API and a
  read-only debug overlay (`specs/instrumentation.md`): a deterministic, seedable,
  render-free core with control operations that arrange a board and drive real
  moves, pointer-injection input, a `snapshot()` of the full observable state, and
  a manual clock for the victory cascade.
- The reviewer checklist is the categories grammar (`[review] format = 2`), and
  most items carry a `validation` script under `validation/` that drives the build
  through the debug API and decides its own verdict, synthesizing side-by-side
  media for the reviewer.
- The seeded specification was cleaned up and its files renamed to natural names
  for this game (`table.md`, `states.md`, `victory.md`), with the deal-mode spec
  still seeded per variant to `specs/deal-mode.md`.

## Why Klondike

Klondike is the solitaire everyone knows, which makes it a good mid-range case:
approachable rules, but a build that demands a correct pile-and-move model,
drag-and-drop interaction, win detection, and a showpiece animation to feel
finished. It exercises state and interaction depth rather than raw rendering, a
useful complement to the arcade cases.

## Contents

| Path                   | Seeded to run? | Purpose                                            |
| ---------------------- | -------------- | -------------------------------------------------- |
| `specs/`               | **Yes**        | The spec handed to the model, by concern.          |
| `workspaces/base/`     | **Yes**        | Starter project seeded to the run root.            |
| `prompt.hbs`           | No             | Rendered into the model's prompt; not seeded.      |
| `reference-impl/`      | No             | Authored, correct playable builds per variant.     |
| reference screenshots  | **Yes**        | Captured from reference-impls; seeded as targets.  |
| `validation/`          | No             | Automated-validation debug scripts.                |
| `test-case.toml`       | No             | Manifest: specs, variants, review, validation.     |
| `description.md`       | No             | Site-facing blurb.                                 |
| `README.md`            | No             | This overview.                                     |

The specification is split across `specs/` by concern: `overview.md`, `table.md`,
`rules.md`, `states.md`, `victory.md` (the signature win animation),
`instrumentation.md` (the debug and automation API), `proof.md`, and the deal-mode
spec seeded per variant to `specs/deal-mode.md`. The common specs are seeded for
both variants; each variant adds its one deal-mode spec.

The case offers two variants, differing only in how many cards the stock turns:

- `draw-three` — the classic Klondike deal (turns three; the default).
- `draw-one` — the gentler deal (turns one; more winnable).

This version has no image assets: every card and the table are drawn in code,
guided by the palette and measurements in the specs and by the seeded reference
screenshots.

The seeded specs and the reference screenshots are copied into a run's repository.
The reference-impl source is not seeded, so a model builds the game from the specs
and the screenshots rather than copying the reference build.

## Versioning

This case follows semantic versioning per version folder. Each version is
self-contained and immutable once a run references it; design revisions land as new
version folders.
