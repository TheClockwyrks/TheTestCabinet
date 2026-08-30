# Coil `v2.0.0` — reference builds

One directory per engine, and under it one per variant, matching the
`[reference_implementation]` table each variant file declares:

| Path | Declared by |
| --- | --- |
| `none/base`, `none/maze` | `variants/base.toml`, `variants/maze.toml` |
| `simple-2d/base`, `simple-2d/maze` | the same two files |
| `structured-2d/base`, `structured-2d/maze` | the same two files |

None of it is seeded into a run. A reference build is the authored, correct
implementation the case's own validators are proven against, and the source
`tcab capture-baselines` builds to capture `validation-baseline/<engine>/<variant>/`.

All six are written.

## The pair under each engine is one project, twice

`diff -rq` over `src/` names exactly one file in each pair:

| Engine | The one file that differs |
| --- | --- |
| `none` | `src/mode.ts` |
| `simple-2d` | `src/constants.ts` |
| `structured-2d` | `src/constants.ts` |

That file names the mode, and everything that follows from it is derived there:
the menu entry and the HUD label, whether the interior carries `OBSTACLE_CELLS`,
whether the debug surface lays `clearObstacles` and `addObstacle`, and which
cells the how-to-play screen calls fatal. A change to anything else belongs in
both copies of the pair, and a change to the sprite set or the cue set belongs in
all six.

Each build is its own npm project rather than a workspace member, so it is
installed and checked from its own directory:

```sh
npm ci
npx tsc --noEmit && npx eslint . && npx prettier --check . && npx vitest run
npm run build
```

Those four commands are what `[toolchain]` declares. An engine-backed build
resolves its engine through a relative `file:` dependency into the repository's
own `packages/<engine>/`, which npm installs as a symlink, so
`npm run build:packages` must have been run at the repository root before
`npm ci` here.

`npm run build` emits a self-contained static site into `dist/`, bundling the
committed files under `assets/` and running with the asset-generation binaries
absent. **The engineless suites drive `dist/`, not `src/`**, so a source change
under `none/` is invisible to them until the project is rebuilt.

`scripts/gen-sprites.sh` and `scripts/gen-audio.sh` are how the files under
`assets/` were produced, and they are run by hand rather than by the build. The
sprite script is identical in all six builds and its output is committed, so a
change to it means regenerating and re-committing the affected PNG in every one.

## The showcase directories

`none/base/showcase` and `none/maze/showcase` hold media captured by
`scripts/capture-showcase.mjs`, which serves the built site, plays it with real
key presses, and writes the clip and the stills. They are a convenience of those
two builds and nothing resolves against them: this version declares no
case-level `showcase/<variant>/` and no `showcase` key on either variant. The
four engine-backed builds ship none, which is what the cases already on this
style do — no reference of `carom` `v3.0.0`, `refract` `v1.0.0` or `fathom`
`v3.0.0` ships a `showcase/` either, and no review item reads one. The showcase
is asked of a build as its own store-page presentation rather than as evidence
any point is judged on.

## Known accommodations

`simple-2d/base` and `simple-2d/maze` depart from the seeded workspace in two
files `specs/overview.md` lists among the ones a build must leave alone, and both
departures exist only because a reference lives inside this repository rather
than in a run's own:

| File | The departure |
| --- | --- |
| `package.json` | `@test-cabinet/simple-2d` resolves to `../../../../../../../../packages/simple-2d` instead of the `.tcab/engine/` copy a seed vendors. |
| `.gitignore` | `dist/` is anchored to this project rather than left to match the vendored engine's own `dist/`, and `.tcab/` is ignored as validator scratch. |

Neither is a defect of the case. The runner grades a run's own tree, no review
item reads a workspace file, and none should. Do not file it again.

## The `v1.0.0` build is not one of them

`none/base` and `none/maze` briefly held the `v1.0.0` build, carried across when
the version's directories were keyed by engine. It was removed rather than left
in place, because it builds and serves: `tcab capture-baselines --engine none`
would have run against it and captured a baseline for a different game under this
version's labels. It implements the `v1.0.0` specification, and it is wrong for
`v2.0.0` in ways a build error would not reveal:

- the debug surface is the old one, with a compound `startRound`, a
  `step(ticks)` clock, keyboard operations, and none of the driver switches,
  the single-field poses, or the obstacle operations `specs/instrumentation.md`
  now fixes;
- the best score and the mute bit are kept in browser storage, which
  `specs/scoring.md` now forbids;
- the produced cue lands at `assets/audio/combo.wav`, where `specs/assets.md`
  now names `assets/audio/combo-up.wav`;
- the project carries no ESLint, Prettier or Vitest configuration, so it does
  not answer the four commands `[toolchain]` declares.

The tree itself is frozen at `../../v1.0.0/reference-impl/` if the old build is
worth reading.
