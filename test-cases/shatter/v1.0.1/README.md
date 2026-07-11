# Shatter — `v1.0.0`

This is version `v1.0.0` of the **Shatter** test case. The implemented game is an
original space-rock shooter titled **Shatter**: inertial flight on a wrap-around
field, rocks that split when shot, escalating waves, and an enemy saucer — all
built around a **gravity well**, a central star that pulls the bullets and the
rocks (the ship flies free of the pull), and that recycles any rock it swallows
back in from the field edge.

`shatter` is the catalog slug for this case, and the game's in-fiction title. The
case is inspired by classic asteroid-shooting arcade games but is not a clone of
any of them — the name, look, and the central gravity-well mechanic are original
to The Test Cabinet.

## Contents

| Path                  | Seeded to run? | Purpose                                                            |
| --------------------- | -------------- | ------------------------------------------------------------------ |
| `specs/`              | **Yes**        | The spec handed to the model, by concern.                          |
| `workspaces/base/`    | **Yes**        | Starter files seeded to the run root (a `package.json`).           |
| `prompt.hbs`          | No             | Rendered into the model's prompt; not seeded.                      |
| `reference/` (source) | No             | Canonical visual mockups; rendered to screenshots.                 |
| reference screenshots | **Yes**        | Rendered from `reference/`; seeded as targets.                     |
| `test-case.toml`      | No             | Manifest: common specs, references, proofs, checks, domain, items. |
| `variants/`           | No             | One TOML file per variant (listed in `variants`).                  |
| `description.md`      | No             | Site blurb.                                                        |
| `README.md`           | No             | This overview.                                                     |

The specification is split across `specs/` by concern: `overview.md`,
`playfield.md`, `physics.md`, `flow.md`, and `proof.md` (which asks the build to
capture its proof-of-implementation media) — all seeded as common specs. Each
variant additionally seeds exactly one **mode spec** to the stable dest
`specs/mode.md` (from a flat `specs/mode-<slug>.md` source), which the common specs
reference by that name.

## Variants

Shatter ships **two** variants against this same target:

- **`base`** (the default, `variants/base.toml`) — the standard endless arcade
  game. It seeds the standard mode spec (`specs/mode-standard.md` → `specs/mode.md`,
  rocks take a single hit and the ship carries only its primary gun) and is rated on
  the common `arcade` scoring domain; it adds nothing else of its own.
- **`warhead`** (`variants/warhead.toml`) — the standard game plus **armored
  rocks** (rocks gain health, so a Large takes several bullet hits to break) and a
  **homing torpedo** secondary weapon (`F`, a single guided munition on a 10-second
  recharge that flies true through the gravity well and shatters any rock outright).
  It seeds its own mode spec (`specs/mode-warhead.md` → `specs/mode.md`) and adds an
  in-game reference view (`warhead`), two proofs (`warhead`, `torpedo`), three review
  items, and its own `warhead` scoring domain.

The common specs defer their mode-varying rules — how rocks take damage, and which
bodies gravity pulls — to the mode spec seeded at the stable dest `specs/mode.md`,
which is always present, so `warhead` states armor and the torpedo while `base`
states the single-hit, primary-gun-only ruleset.

This version has **no assets**: Shatter is simple enough to leave all visuals to
the model, guided by the palette and measurements in the specs and by the seeded
reference screenshots.

The seeded specs and the rendered reference screenshots are copied into a run's
repository. The reference *source* mockups are not seeded, so a model builds the
UI from the specs and the screenshots rather than copying the mockup code.

## Versioning

This case follows semantic versioning per version folder
(`test-cases/shatter/v1.0.0/`). Each version is self-contained and immutable
once a run references it; design revisions land as new version folders.
