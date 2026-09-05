# Volute — `v1.0.0`

Volute is a **full-stack**, `easy` case: an arcade puzzle game in a geothermal
pump hall, where cores ride a fixed channel toward the intake and an injector at
the channel's center fires cores into the train to group and extract them. The
build also produces every sprite, sheet, particle system, and sound the game
plays, with the six 2D asset-generation binaries on the run image's `PATH`.

This file is for people working on the case. Nothing in it is seeded.

## Design intent

- **One number per core.** A core's position on the channel is its arc distance
  from the inlet, and every rule in the case reads and writes that number.
  Advance, merging, insertion, recoil, and backflow are all arithmetic on arc
  positions, and the field position is derived from one. That is what makes an
  exactly specified case out of a winding path, and what lets a validator assert
  a position to half a unit on a corner.
- **Easy by rule, substantial by count.** No rule needs more than a table row or
  a one-line formula, and nothing here needs physics tuned or an opponent
  modeled. What is measured is whether a build carries the whole set — the two
  advance rates, the two extraction events, the chain, four machineries, five
  levels, seven screens — through without blurring a row. The asset pass is what
  `max_runtime_hours = 6` accounts for, not the difficulty.
- **Determinism through debug verbs.** A scenario poses the moment it wants
  rather than replaying a level from a seed. `setScreen`, `setLevel`, `setScore`,
  `setCells`, `setChainStep`, `startLevel`, `clearTrain`, `poseTrain`,
  `setLoaded`, `setQueued`, `setAim`, `fire`, `setPressure`,
  `setQuotaRemaining`, `setEmission`, `setFeed` and `grantMachinery` all route
  through the real systems, and no operation decides an outcome, so every
  extraction, score and chain a validator reads comes from stepping the game.
  `instrumentation.pose-decides-nothing` is the point that holds a build to
  that.
- **Appearance is free; legibility is fixed.** The palette, the type, the
  glyphs, the sprite artwork and the animation timing are the build's own. What
  is specified is what a player must read: five charges told apart on the
  channel, told apart again with color removed, standing off the plate behind
  them, and six HUD readouts.

## Where things live

| Path | Seeded? | What it is |
| --- | --- | --- |
| `specs/` | **Yes** | The eleven-file specification, by concern. |
| `workspaces/<engine>/` | **Yes** | The starter project for the run's engine, seeded to the run root. |
| `prompt.hbs` | No | Rendered per run into the model's instruction. |
| `test-case.toml` | No | The manifest: engines, build, toolchain, specs, domains, checklist. |
| `variants/base.toml` | No | The single variant, and the per-engine `[reference_implementation]` table. |
| `references/<engine>/base/` | No | The authored, correct build of the variant, one per engine. |
| `description.md` | No | The site blurb. |
| `changelog.md` | No | This version's entry. |
| `README.md` | No | This file. |

The eleven specs are common, seeded for every run. Six are `.hbs` templates and
branch on `engine.slug` alone — `overview`, `controls`, `ui`, `state`,
`instrumentation`, and `assets`, which are the files that speak of the runtime
under the game. The other five (`channel`, `injector`, `extraction`,
`machinery`, `progression`) are plain Markdown, identical under every engine,
because the rules they state are the same whoever owns the frame loop. Nothing
branches on the variant: the case has one, so a seeded set never mentions a mode
or an alternative.

`channel.md` is the file the rest lean on. It carries the polyline, the
arc-position rule, the segment definition, and the order a tick resolves in, and
that tick order is what lets a validator assert an exact tick for a merge, an
insertion, a grant, or a cell spend.

## The three workspaces

- `workspaces/none/` — configuration and `index.html` only. The build writes
  `src/` and the whole runtime beneath the game.
- `workspaces/simple-2d/` — the same configuration plus `src/constants.ts`
  (every figure the specs fix, which a validator imports) and `src/main.ts` (the
  entry). The build writes `src/game.ts`.
- `workspaces/structured-2d/` — the same two case-owned modules against the
  framework engine. The build writes the game definition the engine drives.

All three depend on `@clockwyrks/particle-runtime` at the
`file:./.vendor/packages/@clockwyrks/particle-runtime` path the manifest's
`packages` key requires, which is why `init` is `npm install` while
`[build].install` stays `npm ci`. The engine workspaces additionally carry the
engine's own `file:` dependency, written in at seed time.

## The checklist

One hundred and twenty-nine items across eleven categories, in the categories
grammar (`[review] format = 2`), every one weighted `1`. The case is on the
per-engine spelling and so is validator-rated: every item carries `validation`,
`failure_cap`, and `domains`. Four domains — `channel`, `injector`,
`progression`, and `presentation` — and the run's functional rating is the worst
across them.

A `validation.script` path is relative to `validation/<engine>/`. Most points
cover all three engines, so the same path exists under all three engine
directories and a point is never decided under one engine and left to a reviewer
under another. Sixteen points name `engines` instead, because what they decide
belongs to the runtime rather than to the build under the engines they leave out:
`channel/self-advancing`, `injector/swap-pointer` and `screens/start-touch` run
under `none` alone, where the build writes the frame loop and the input layer,
and the thirteen cue-identity points of the `audio` category run under
`simple-2d` and `structured-2d` alone, where the engine's bus reports the name a
cue sounded under. A scoped point is left out of the checklist of a run on an
engine it does not name, and adds no weight to that run's score. Every script is
named `<category>/<item>.test.ts`.

Motion is handed back as a `replay` — the draw-command recording a validator
takes off the recorder it arms itself — rather than as a `video`, which is a
browser drive's one screen capture and which none of the three validator
projects can encode.

## Design decisions the specs pinned down

The brief left several figures a validator could not decide as written; the
specs close each of them.

- **Turn direction.** Turn left swings the aim counter-clockwise on screen and
  turn right clockwise, both at 180 degrees per second (`controls.md`).
- **The bore's metric.** `BORE_RADIUS` is straight-line distance across the
  field from the position the marked core held when its run was extracted, not
  arc distance along the channel (`machinery.md`).
- **The first emission.** A channel carrying no core satisfies the emission
  condition, so an emission follows at once rather than waiting on a tail that
  does not exist (`channel.md`).
- **The mark count after a setback.** The count of cores entering a level, and
  with it the position in the machinery cycle, restarts whenever a level starts,
  a level restarted after a lost cell included (`machinery.md`).
- **Danger is observable.** The snapshot reports a `danger` flag, and the field
  carries a visible warning while it holds (`instrumentation.md`,
  `progression.md`).
- **Recoil is grouped.** A removal recoils each trailing group by up to
  `RECOIL`, clamped by the room the group ahead leaves and by the inlet
  (`extraction.md`).

## The reference implementations

One authored, **correct** build per engine, under `references/none/base`,
`references/simple-2d/base`, and `references/structured-2d/base`, declared from
`variants/base.toml` as a per-engine `[reference_implementation]` table. Each is
the case's seeded workspace for that engine with the game implemented and its own
tests written beside it, so what is there is exactly what a run on that engine is
asked to produce. None of them is ever seeded into a run.

Because Volute is a full-stack case, each reference also carries the asset set a
run is asked to produce — fifty-two files, identical byte for byte under all
three references — committed beside the source and bundled by the build. The
build itself never invokes `draw`, `draw-sheet`, `particle-2d`, `sfx-synth`,
`sfx-sample` or `music`: those tools exist on the run image's `PATH` for the model
under test, not for a build, so `npm ci && npm run build` succeeds with none of
them present. `vite.config.ts` sets `base: "./"`, so the emitted `dist/` plays
from any sub-path, which is how a finished run is served from `/runs/<id>/build/`.

The engine and the particle runtime are resolved through relative `file:`
dependencies on the repository's own `packages/`, which npm installs as symlinks —
so nothing of either is committed under a reference.

## Still to do

- The validator suites under `validation/none/`, `validation/simple-2d/`, and
  `validation/structured-2d/`, one file per checklist item at the path the
  manifest names. Until they exist the version does not resolve, because
  resolution requires every declared script to be a file in the validator
  project of each engine its validation covers, and no item here narrows itself
  with `engines`.
- Baselines from `tcab capture-baselines` once the suites exist, committed under
  `validation-baseline/<engine>/base/`.
- Curated showcase media captured from the reference builds, and a `showcase` key
  in `variants/base.toml` naming it.

## Versioning

Versions are immutable once a run references one. Revise the case by adding a
new version folder rather than editing this one.
