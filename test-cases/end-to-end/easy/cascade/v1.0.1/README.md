# Cascade — `v1.0.0`

This is version `v1.0.0` of the **Cascade** test case. The implemented game is
an original Klondike solitaire titled **Cascade**: the classic patience — seven
tableau columns, four foundations built Ace-to-King by suit, a stock and waste —
finished with a physics-driven **victory cascade** where the foundation cards
bounce off the table and paint the screen.

`cascade` is the catalog slug for this lineage, and the game's in-fiction title
(Klondike is the public-domain set of solitaire rules it implements). The case is
inspired by classic solitaire but is not a clone of any existing product — the
name, table, card design, palette, and win animation are original to The Test
Cabinet. The rules of Klondike are specified exactly; no existing product's
assets or look are reproduced.

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
| `reference/` (source)  | No             | Canonical visual mockups; rendered to screenshots. |
| reference screenshots  | **Yes**        | Rendered from `reference/`; seeded as targets.     |
| `test-case.toml`       | No             | Manifest: specs, variants, checks, review items.   |
| `description.md`       | No             | Site-facing blurb.                                 |
| `README.md`            | No             | This overview.                                     |

The specification is split across `specs/` by concern: `overview.md`,
`layout.md`, `rules.md`, `flow.md`, `cascade.md` (the signature win animation),
`proof.md`, and the deal-mode specs under `specs/modes/`. The common specs
(overview, layout, rules, flow, cascade, proof) are seeded for both variants; each
variant adds its one deal-mode spec.

The case offers two variants, differing only in how many cards the stock turns:

- `draw-three` — the classic Klondike deal (turns three; the default).
- `draw-one` — the gentler deal (turns one; more winnable).

This version has **no assets**: every card and the table are drawn in code,
guided by the palette and measurements in the specs and by the seeded reference
screenshots.

The seeded specs and the rendered reference screenshots are copied into a run's
repository. The reference *source* mockups are not seeded, so a model builds the
UI from the specs and the screenshots rather than copying the mockup code.

## Versioning

This case follows semantic versioning per version folder
(`test-cases/cascade/v1.0.0/`). Each version is self-contained and immutable once
a run references it; design revisions land as new version folders.
