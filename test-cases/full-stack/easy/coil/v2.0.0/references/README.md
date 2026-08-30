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

Version resolution requires all six directories to exist, so each holds a
`.gitkeep` until its build lands. That marker is the whole of what is there.

## All six are empty

No `v2.0.0` reference exists for any engine yet. Each build is written against
the seeded specification of this version, engine by engine, and installed into
its own directory.

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
worth reading while a new one is written.
