# Shatter — `v1.0.0`

This is version `v1.0.0` of the **Shatter** test case. The implemented game is an
original space-rock shooter titled **Shatter**: inertial flight on a wrap-around
field, rocks that split when shot, escalating waves, and an enemy saucer — all
built around a **gravity well**, a central star that pulls the ship, the bullets,
and the rocks, and that recycles any rock it swallows back in from the field edge.

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
capture its proof-of-implementation media). All five are seeded.

## Variants

Shatter ships a single mode, so it has one variant — `base`, the standard endless
arcade game — declared in `variants/base.toml`. It seeds the common specs and is
rated on the case's single `arcade` scoring domain; it adds no specs, references,
review items, or domains of its own. A case must declare at least one variant, and
a single-mode game needs only this one. Future modes (for example a denser "rush"
variant, or one that changes the gravity) would be added as additional variant
files against this same target.

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
