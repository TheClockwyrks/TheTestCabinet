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

Each check is posed where the specification is unambiguous, and reads the outcome
after the simulation has run it. A bay is entered at the column its two-tile opening
straddles under either reading of "centered near columns 4, 12, 20, 28, and 36", so
the one-tile latitude the layout leaves cannot decide the fill, the level clear, the
scoring, the respawn, or the hunter's fair reset — where the openings actually sit is
the bays' own item. The critter's footing is read after a step rather than off the
placement that posed it, since `placeCritter` hands the footing to the step that
follows. A hop into traffic is driven upward into the flank of a vehicle that is
moving, once it covers the whole tile, which is the situation the rule exists for and
the only staging every build agrees is occupied. And mute is toggled — both ways —
during a live crossing, where the game is making the sound the toggle silences,
rather than on the title screen, which no part of the specification asks it to
answer on.

The clips those checks synthesize show the behavior they decide. A refused hop is a
non-event — the critter ends where it began — so the Movement items hold the posed
block on camera, keep the direction held down against it, and hold again on the
critter that did not move, instead of cutting a tenth of a second after the press. For the
same reason the checks about MOTION are filmed rather than photographed: the ice
band's alternating lanes and its per-level speeds are clips now, the second running
level 1 and then level 8 back to back, because a still frame of traffic says nothing
about which way it is going or how fast. Every clip that ends on an event — a death,
a bay filled, a level cleared — keeps rolling long enough to show what the event cost,
and every one that begins on an event opens before it instead of on top of it.

Each item is also posed so that it fails on its own subject. A bay is entered at the
column both readings of the far-shore layout contain; a clean crossing climbs to that
same column; the bays' own item tops the run's lives back up between bays and restarts
a run the build has ended, so a hunter that spawns on a fresh critter cannot make the
far shore read as closed. Two checks that a build could satisfy without doing the
thing they name are tightened: the hunter emerging is now measured against the "only"
in the rule — a fresh critter left standing on the near shore must not be hunted at
all — and the timer costing a life now requires the clock to have actually run down,
so a crossing that ended some other way cannot be read as the timer's doing.

## A vehicle's tile is closed to the bear

`specs/hunter.md` gave the bear and the critter the same rule about who is at fault in
a collision — traffic resets you by arriving on you, never by your moving into it — but
drew it differently for each: the critter's hop into an occupied tile is refused, while
the bear was described as travelling onto a vehicle and simply not being reset for it.
That second half required a bear and a car to share a tile, which is not a state the
game should ever be in. Now the board answers both the same way: a tile a vehicle covers
cannot be entered by the bear either, the move is refused, and nothing is taken from it
for trying. The reset rule is unchanged — a vehicle whose own motion arrives on a tile
the bear occupies still knocks it out — and so is the pursuit, which already routed
around traffic rather than into it.

## A completed crossing scores its last row

`specs/gameplay.md` now says outright that the bay row counts as a row advanced like
any other, and gives the arithmetic for the final hop of a crossing: `10 + 50 + 2 * T`
with `T` whole seconds left on the timer. The two awards were listed separately with
nothing saying whether the row rule stopped at the water's edge, and it is the kind of
gap each reader closes silently and differently.

## The HUD's lives are the run's lives

`specs/ui.md` now says what the LIVES readout counts: the total the run has left,
including the critter currently crossing, so a new run reads three. Read as the spares
behind the current critter it reads two, which is a different number for the same state
and no way for a player to tell which they are looking at.

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
