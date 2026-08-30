# Shatter — `v3.0.0`

This is version `v3.0.0` of the **Shatter** test case. The implemented game is an
original space-rock shooter titled **Shatter**: inertial flight on a wrap-around
field, rocks that split when shot, escalating waves, and an enemy saucer — all
built around a **gravity well**, a central star that pulls the bullets and the
rocks (the ship flies free of the pull), and that recycles any rock it swallows
back in from the field edge.

`shatter` is the catalog slug for this case, and the game's in-fiction title. The
name, look, and the central gravity-well mechanic are original to The Test Cabinet
and not a clone of any existing game.

This is a major bump, because every axis of the case changes: **three engines**
(`none`, `simple-2d`, `structured-2d`) instead of one, a rewritten debug surface
with no operation carried over unchanged, a rewritten and re-split spec set,
per-engine per-variant reference implementations, per-engine vitest validator
suites in place of the browser `.mjs` drivers, per-variant showcases in place of
the proof captures, and **no seeded palette and no reference mockups** — the look
is the build's. See `changelog.md` for the full upgrade.

## Contents

| Path                   | Seeded to run? | Purpose                                                             |
| ---------------------- | -------------- | ------------------------------------------------------------------- |
| `specs/`               | **Yes**        | The specification handed to the model, decomposed by concern.        |
| `workspaces/`          | **Yes**        | The starter project seeded to the run root, one per engine.          |
| `prompt.hbs`           | No             | Rendered into the model's prompt; not seeded.                        |
| `references/`          | No             | The authored, correct builds, per engine and variant.                |
| `showcase/`            | No             | The curated demo media shown for each variant on the site.           |
| `validation/`          | No             | The vitest validator projects, one per engine (reporter-side).       |
| `validation-baseline/` | No             | The committed baseline media, per engine and variant.                |
| `test-case.toml`       | No             | Manifest: engines, workspaces, specs, domains, the review checklist. |
| `variants/`            | No             | One TOML file per variant (listed in `variants`).                    |
| `description.md`       | No             | Site blurb.                                                          |
| `changelog.md`         | No             | What changed in this version.                                        |
| `README.md`            | No             | This overview.                                                       |

There is deliberately no `reference/` directory, no `reference-impl/`, no
`specs/proof.md`, and no `assets/`: this version declares no `[[reference]]`, no
`[[proof]]` and no `[[check]]`, every piece of evidence a reviewer sees is
captured by this case's own validators, and every body on the field is drawn in
code.

## Engines

An engine is a **run dimension**, chosen per run alongside the model, the harness
and the variant. The game is the same under all three; what differs is how much
of the build is handed over.

- **`none`** — no runtime and no `src/` at all. The build writes the frame loop
  and its fixed-step accumulator, the canvas fit, the keyboard, the audio, the
  overlay and the `window.__shatter` surface itself.
- **`simple-2d`** — the runtime is vendored as a package; the workspace seeds
  `src/constants.ts`, `src/main.ts` and a `src/game.ts` stub the build replaces.
- **`structured-2d`** — the framework engine is vendored the same way; the
  workspace seeds `src/constants.ts` and `src/main.ts`, and `src/game.ts` is
  deliberately absent, so the first `tsc` on a fresh checkout fails by design.

## Variants

Shatter ships **two** variants against this same target:

- **`base`** (the default, `variants/base.toml`) — the endless arcade game: a
  rock is destroyed by a single hit and the ship carries only its gun. It seeds
  no specs and adds no review points of its own, so a base run is rated on the
  207 common points.
- **`warhead`** (`variants/warhead.toml`) — the same game with **armored rocks**
  (a rock carries health, so a Large takes three hits) and a homing **torpedo**:
  one guided munition on a ten-second recharge that flies true through the well
  and destroys any rock outright, blasting its fragments outward far harder than
  the gun does. It adds 47 review points, so a warhead run is rated on 254.

Both variants are the same single game, rated on the same four domains —
`gravity`, `flight`, `arcade` and `presentation` — and the variant declares none
of its own. What differs is branched inside the common `.hbs` specs and rendered
before they land, so no seeded text ever names the sibling variant.

## Versioning

This case follows semantic versioning per version folder
(`test-cases/end-to-end/easy/shatter/v3.0.0/`). Each version is self-contained and
immutable once a run references it; design revisions land as new version folders.
