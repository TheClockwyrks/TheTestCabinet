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

## Nothing here is a `v2.0.0` reference yet

`simple-2d/` and `structured-2d/` hold no sources at all.

`none/base` and `none/maze` hold the `v1.0.0` build, carried across when the
version's directories were keyed by engine. It implements the `v1.0.0`
specification, not this one, and it is wrong for `v2.0.0` in ways a build error
would not reveal:

- the debug surface is the old one, with a compound `startRound`, a
  `step(ticks)` clock, keyboard operations, and none of the driver switches,
  the single-field poses, or the obstacle operations `specs/instrumentation.md`
  now fixes;
- the best score and the mute bit are kept in browser storage, which
  `specs/scoring.md` now forbids;
- the project carries no ESLint, Prettier or Vitest configuration, so it does
  not answer the four commands `[toolchain]` declares;
- it ships no `showcase/` directory.

So do not build it, validate against it, or capture a baseline from it. Write
each reference against the seeded specification, engine by engine, and replace
these two directories wholesale. The `v1.0.0` tree is frozen at
`../../v1.0.0/reference-impl/` if the old build is worth reading.
