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

Version resolution requires all six directories to exist, so one that has no
build yet holds a `.gitkeep`, and that marker is the whole of what is there.

## What is built

| Path | State |
| --- | --- |
| `none/base`, `none/maze` | Built. A Vite + TypeScript project on no engine, with its produced assets, its own tests, and its showcase. |
| `simple-2d/base`, `simple-2d/maze` | Not written yet. A `.gitkeep` holds the directory. |
| `structured-2d/base`, `structured-2d/maze` | Not written yet. A `.gitkeep` holds the directory. |

## The two engineless builds

They are one project, twice. `diff -rq` over the pair names `src/mode.ts` and
nothing else outside `showcase/`, whose media is captured from each build in
turn. That one file names the mode, and everything that follows from it is
derived there: the menu entry and the HUD label, whether the interior carries
`OBSTACLE_CELLS`, whether the debug surface lays `clearObstacles` and
`addObstacle`, and which cells the how-to-play screen calls fatal.

Each is its own npm project rather than a workspace member, so it is installed
and checked from its own directory:

```sh
npm ci
npx tsc --noEmit && npx eslint . && npx prettier --check . && npx vitest run
npm run build
```

`npm run build` emits a self-contained static site into `dist/`, bundling the
committed files under `assets/` and running with the asset-generation binaries
absent. `scripts/gen-sprites.sh` and `scripts/gen-audio.sh` are how those files
were produced, and they are run by hand rather than by the build.
`scripts/capture-showcase.mjs` serves the built site, plays it with real key
presses, and writes the showcase media.

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
  not answer the four commands `[toolchain]` declares;
- it ships no `showcase/` directory.

The tree itself is frozen at `../../v1.0.0/reference-impl/` if the old build is
worth reading while the remaining four are written.
