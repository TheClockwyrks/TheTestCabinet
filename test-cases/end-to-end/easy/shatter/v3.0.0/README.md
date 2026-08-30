# Shatter — `v2.0.2`

This is version `v2.0.2` of the **Shatter** test case. The implemented game is an
original space-rock shooter titled **Shatter**: inertial flight on a wrap-around
field, rocks that split when shot, escalating waves, and an enemy saucer — all
built around a **gravity well**, a central star that pulls the bullets and the
rocks (the ship flies free of the pull), and that recycles any rock it swallows
back in from the field edge.

`shatter` is the catalog slug for this case, and the game's in-fiction title. The
name, look, and the central gravity-well mechanic are original to The Test Cabinet
and not a clone of any existing game.

This version adds a required **debugging and automation surface** (`window.__shatter`)
and a read-only debug overlay to every variant, backed by a deterministic, steppable
core, and moves the reviewer checklist onto that surface so its objective points are
decided by automated validation scripts. See `changelog.md` for the full upgrade.

## Contents

| Path                  | Seeded to run? | Purpose                                                              |
| --------------------- | -------------- | -------------------------------------------------------------------- |
| `specs/`              | **Yes**        | The spec handed to the model, by concern.                            |
| `workspaces/base/`    | **Yes**        | Starter files seeded to the run root (a `package.json`).             |
| `prompt.hbs`          | No             | Rendered into the model's prompt; not seeded.                        |
| `reference/` (source) | No             | Canonical visual mockups; rendered to screenshots.                   |
| reference screenshots | **Yes**        | Rendered from `reference/`; seeded as targets.                       |
| `reference-impl/`     | No             | The authored, correct playable builds (per variant).                 |
| `validation/`         | No             | Automated-validation debug scripts (reporter-side).                  |
| `test-case.toml`      | No             | Manifest: instrumentation, common specs, references, proofs, review. |
| `variants/`           | No             | One TOML file per variant (listed in `variants`).                    |
| `description.md`      | No             | Site blurb.                                                          |
| `README.md`           | No             | This overview.                                                       |

The specification is split across `specs/` by concern: `overview.md`, `playfield.md`
(the field and the star), `ship.md` (the ship and its bullets), `hazards.md` (the
rocks and the saucer), `simulation.md` (the loop, the gravity well, and collision),
`gameplay.md` (scoring, lives, waves, how rocks take damage, the weapons, and the
controls), `ui.md` (the menus and game states, the HUD, and audio),
`instrumentation.md` (the `window.__shatter` debug API, the debug overlay, and the
deterministic core), and `proof.md` (which asks the build to capture its
proof-of-implementation media) — all seeded as common specs. There is no separate
per-variant mode spec: what differs between the variants is branched by variant slug
inside three `.md.hbs` templates — `gameplay.md.hbs` and `ui.md.hbs` (the
standard-vs-Warhead rules, HUD, and how-to-play text) and `instrumentation.md.hbs`
(its torpedo and rock-health wording) — each rendered with the selected variant before
it lands.

## Variants

Shatter ships **two** variants against this same target:

- **`base`** (the default, `variants/base.toml`) — the standard endless arcade
  game: rocks take a single hit and the ship carries only its primary gun (the default
  branch of `specs/gameplay.md.hbs`). It seeds no specs, references, or review points
  of its own.
- **`warhead`** (`variants/warhead.toml`) — the standard game plus **armored
  rocks** (rocks gain health, so a Large takes several bullet hits to break) and a
  **homing torpedo** secondary weapon (`F`, a single guided munition on a 10-second
  recharge that flies true through the gravity well and shatters any rock outright).
  Those rules are the `warhead` branch of `specs/gameplay.md.hbs` and `specs/ui.md.hbs`
  (selected by slug), and the variant adds an in-game reference view (`warhead`), two
  proofs (`warhead`, `torpedo`), and its own review points.

Both variants are the same single game mode, so the case has one scoring domain —
the common `arcade` domain — and every review point, common or `warhead`-only, rolls
up to it.

This version has **no assets**: Shatter is simple enough to leave all visuals to
the model, guided by the palette and measurements in the specs and by the seeded
reference screenshots. The reference *source* mockups are not seeded, so a model
builds the UI from the specs and the screenshots rather than copying the mockup code.

## Versioning

This case follows semantic versioning per version folder
(`test-cases/end-to-end/easy/shatter/v2.0.2/`). Each version is self-contained and
immutable once a run references it; design revisions land as new version folders.
