## Added the `window.__floe` debug API and overlay

A new common spec, `specs/instrumentation.md`, adds a `window.__floe` debugging and
automation API and a read-only debug overlay, backed by the deterministic,
fixed-step, render-free core the simulation already runs on — `reset`/`step`/
`snapshot`, control operations to pose the run, and injected keyboard input. A new
mandatory deliverable, hence the major bump.

## The debug API can hold a scene still

`specs/instrumentation.md` gains three control operations, all of them about being able
to set a situation up exactly rather than approximately:

- `setBearAI(enabled)` suspends the hunter's pursuit brain, so a bear holds the tile it
  is put on however far the simulation is stepped. It suspends the pursuit and nothing
  else — a sliding hazard still resets the bear, the water still carries or submerges
  it, it still catches a critter that reaches it, and a reset bear still re-emerges — so
  a scenario can be built around a bear that stays where it is put without making it
  immune to the world.
- `setLaneMotion(row, spec)` changes a lane's speed and direction while leaving its
  contents exactly where they are, so traffic can be laid out precisely, left parked
  while the rest of the scene is arranged, and then released. `setLane` repopulates the
  lane, which loses any positions built up over many steps; this does not.
- `moveBear(index, direction)` sends a bear one tile in a grid direction under the
  caller's control instead of the pursuit's, using the real glide rather than a
  teleport, and without consulting the route the pursuit would have taken — so a bear
  can be driven somewhere it would normally route around.
- `setBear` now accepts `{ x, y }` as well as `{ col, row }`, placing a bear at an exact
  strait-local pixel position. The bear glides continuously and is normally part-way
  between two tiles, and only the pixel form can put it there.

## The checklist is validated automatically

The reviewer checklist moves to the categories grammar with per-item validation
scripts that drive the real simulation through the debug handle, so the crossing,
the hazards, the water, the bays, the hunter, the progression, the scoring, and the
colors are checked automatically; feel, art, and audio stay human review.

## Every death pauses before the respawn

`specs/gameplay.md` now gives **every** death a brief pause of about `1 s` before the
fresh critter appears, rather than pausing only the bear's re-emergence. Without it a
build is free to resolve a death within the tick that caused it, which hands the fresh
critter straight back to a key the player has not yet let go of — a tap that drowns
you also walks you off the near shore before you can react. `specs/instrumentation.md`
anchors the snapshot's `phase` to that pause: `"dying"` is now defined as the death
pause (and `"crossing"` and `"clearing"` are defined alongside it), where before the
three were listed as possible values with nothing saying when each holds.

## Other changes

- Cleaned the specifications so each reads as one self-contained, fully
  authoritative game: removed historical and "inspired by" framing, edge-case and
  gotcha call-outs, test-framing, and prescriptive verification advice, and folded
  the single mode into `specs/gameplay.md`.
