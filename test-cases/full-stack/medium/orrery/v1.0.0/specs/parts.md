# Orrery — Parts

This file defines every part a machine is built from: the arms that carry
motes, the zodiac wheel, the track arms ride on, and the placement rules and
costs that govern all of them, sigils included. The sigils' own footprints and
effects are in `specs/sigils.md`, the instructions an arm executes are in
`specs/instructions.md`, and how everything moves is in `specs/simulation.md`.
The hex geometry every rule below leans on is in `specs/field.md`.

## The parts roster

`PARTS` holds the twenty-one part kinds in this order. The tray in
`specs/editor.md` lists a challenge's permitted parts in it.

| Kind | Class | What it is |
| --- | --- | --- |
| `arm` | mechanism | A single-gripper arm. |
| `biarm` | mechanism | Two grippers, on opposite spokes. |
| `triarm` | mechanism | Three grippers, on every second spoke. |
| `hexarm` | mechanism | Six grippers, one per spoke. |
| `piston` | mechanism | A single-gripper arm whose length changes at run time. |
| `wheel` | mechanism | The zodiac wheel: six fixture motes on a rotating hub. |
| `track` | mechanism | A path of hexes an arm rides along. |
| `bind` | sigil | Joins two motes with a filament. |
| `manifold` | sigil | Joins a center mote to up to three neighbors at once. |
| `triune` | sigil | Joins two `nova` motes with a triune filament. |
| `sunder` | sigil | Removes a filament. |
| `wane` | sigil | An essence becomes `dust`. |
| `mirror` | sigil | Copies an essence onto an adjacent `dust`. |
| `ascend` | sigil | Spends `mercury` to raise a planet one rung. |
| `conjoin` | sigil | Two of one planet become one of the next. |
| `eclipse` | sigil | Two `dust` become `umbra` and `lumen`. |
| `confluence` | sigil | The four essences become `aether`. |
| `dispersion` | sigil | `aether` becomes the four essences. |
| `void` | sigil | Consumes an unbonded, unheld mote. |
| `rise` | sigil | Where a reagent enters the field. |
| `set` | sigil | Where a finished constellation leaves it. |

`bind` through `void` are the twelve transforming sigils; `rise` and `set` are
the other two.

Every placed arm, wheel, and sigil carries an anchor hex and a rotation `0` to
`5`, and a `track` carries its path. Rotation turns the part's shape by 60
degree steps using the formulas in `specs/field.md`.

## Arms

`arm`, `biarm`, `triarm`, `hexarm`, and `piston` share one anatomy: a base
fixed on the anchor hex, a length, and one gripper per spoke at
`base + length * DIRS[d]` for each spoke direction `d`. The part's rotation
names its first spoke, and the variant names the rest:

| Kind | Spokes, relative to `rotation` |
| --- | --- |
| `arm`, `piston` | `rotation` |
| `biarm` | `rotation`, `rotation + 3` |
| `triarm` | `rotation`, `rotation + 2`, `rotation + 4` |
| `hexarm` | all six |

Length is a whole number from `ARM_MIN_LEN` (`1`) to `ARM_MAX_LEN` (`3`),
chosen in the editor. For a `piston` the chosen length is its rest length, and
the `extend` and `retract` instructions change it at run time, faulting at the
bounds as `specs/simulation.md` defines. Every other arm keeps its chosen
length. All spokes of a multi-gripper arm share the one length.

An arm's placed rotation and length are its rest pose. Each run starts every
arm at its rest pose, and the `reset` entry of `specs/instructions.md` returns
an arm to it.

Only motes collide, so a gripper and the drawn arm between base and gripper
pass over any hex, on or off the field, and over any part.

## The zodiac wheel

A `wheel` is a hub on its anchor hex carrying six fixture motes, one on each
adjacent hex. `WHEEL_MOTES` holds the ring at rotation `0`, by spoke:

| Spoke `d` | Fixture |
| --- | --- |
| `0` | `nebula` |
| `1` | `comet` |
| `2` | `nova` |
| `3` | `meteor` |
| `4` | `dust` |
| `5` | `dust` |

The wheel's rotation turns the whole ring, so the fixture on spoke `d` is the
entry above for `d - rotation` modulo `6`. `specs/simulation.md` states when a
run raises its fixtures and discards them, and `specs/field.md` how a fixture
behaves.

A wheel carries a tape like an arm; `specs/instructions.md` states which
instructions it accepts. Its anatomy is the hub and its ring alone, so its
`length` is always `1`, as `specs/formats.md` records.

## Track

A `track` is an ordered path of distinct hexes, `cells`, laid one hex at a
time in the editor. Consecutive cells are adjacent. A track is `closed` when
its last cell is adjacent to its first and the editor has joined them into a
loop, as `specs/editor.md` describes; otherwise it is open. A track of one
cell is legal and open.

An arm or wheel whose anchor hex is a cell of a track is mounted on that track.
The `advance` instruction carries a mounted arm's base to the next cell of the
path and `recede` to the previous one; on a closed track both wrap between the
ends, and on an open track moving past either end faults. The held motes travel
with the base, as `specs/simulation.md` defines. Mounting is positional: moving
a track or an arm in the editor changes what is mounted.

## Rises and sets

A `rise` delivers one reagent and a `set` receives one product, drawn from the
challenge's reagents and products as `specs/formats.md` defines them. The tray
that offers them is in `specs/editor.md`.

A rise or set is placed at an anchor and rotation like any sigil, and its
footprint is its pattern's hexes placed at that pose: the molecule pattern for
a rise, and for a set the pattern plus, when the product repeats, the pattern
translated once by the repeat vector. What a rise spawns and what a set
consumes are defined in `specs/sigils.md`.

## Placement rules

A placement, whether by hand in the editor or through a loaded solution, is
legal exactly when all of the following hold. `specs/editor.md` states how the
editor refuses an illegal placement, and `specs/formats.md` what makes a loaded
solution legal.

1. Every hex of the part is on the field: an arm or wheel's anchor, every
   cell of a track, and every footprint hex of a sigil, rise, or set.
2. Sigil footprints, rise and set footprints included, are pairwise disjoint,
   and no track cell lies on any of them.
3. No hex is a cell of two tracks, or of one track twice.
4. No two arms or wheels share an anchor hex. An arm or wheel's anchor may sit
   on any sigil footprint hex, a rise's and a set's included, or on a track
   cell; sitting on a track cell is what mounts it.
5. Each rise and each set is placed at most once.
6. A track's consecutive cells are adjacent, and a closed track's last cell
   is adjacent to its first and its path holds at least three cells.

## Costs

A machine's cost is the sum of its placed parts' costs. `PART_COSTS` fixes
them:

| Part | Cost |
| --- | --- |
| `arm` | `20` |
| `biarm` | `30` |
| `triarm` | `40` |
| `hexarm` | `60` |
| `piston` | `40` |
| `wheel` | `30` |
| `track` | `5` per cell |
| `bind` | `10` |
| `manifold` | `30` |
| `triune` | `20` |
| `sunder` | `10` |
| `wane` | `10` |
| `mirror` | `20` |
| `ascend` | `20` |
| `conjoin` | `20` |
| `eclipse` | `30` |
| `confluence` | `20` |
| `dispersion` | `20` |
| `void` | `0` |
| `rise` | `0` |
| `set` | `0` |

The finished machine's cost is one of the three metrics `specs/simulation.md`
records.

## Presentation

The part art is produced during this build, as `specs/assets.md` states. What
the look must deliver:

1. Each of the twenty-one part kinds is identifiable on the field, and the
   twelve transforming sigils read apart from one another.
2. An arm's spokes, its length, and whether each gripper is holding are
   visible.
3. A sigil's footprint hexes are visible, and the hexes `specs/sigils.md` gives
   roles to read apart.
4. A track's path reads as a path, with its two ends visible while it is open.
5. A rise shows its reagent's pattern and a set shows its product's pattern.
