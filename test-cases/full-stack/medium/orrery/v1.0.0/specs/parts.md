# Orrery — Parts

This file defines every part a machine is built from: the arms that carry
motes, the zodiac wheel, the track arms ride on, and the placement rules and
costs that govern all of them, sigils included. The sigils' own footprints and
effects are in `specs/sigils.md`, the instructions an arm executes are in
`specs/instructions.md`, and how everything moves is in `specs/simulation.md`.
The hex geometry every rule below leans on is in `specs/field.md`.

## The parts roster

`PARTS` holds every part kind, in this order. The order is load-bearing: the
tray in `specs/editor.md` lists a challenge's permitted parts in it.

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
| `mirror` | sigil | `dust` becomes a copy of a neighboring essence. |
| `ascend` | sigil | Spends `mercury` to raise a planet one rung. |
| `conjoin` | sigil | Two of one planet become one of the next. |
| `eclipse` | sigil | Two `dust` become `umbra` and `lumen`. |
| `confluence` | sigil | The four essences become `aether`. |
| `dispersion` | sigil | `aether` becomes the four essences. |
| `void` | sigil | Consumes a lone mote. |
| `rise` | sigil | Where a reagent enters the field. |
| `set` | sigil | Where a finished constellation leaves it. |

Every placed part carries an anchor hex and a rotation `0` to `5`. Rotation
turns the part's shape by 60 degree steps using the formulas in
`specs/field.md`.

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
the `extend` and `retract` instructions move it within the same bounds at run
time; every other arm keeps its chosen length. All spokes of a multi-gripper
arm share the one length.

An arm's placed rotation and length are its rest pose. Each run starts every
arm at its rest pose, and the `reset` entry of `specs/instructions.md` returns
an arm to it.

A gripper may reach over any hex, on or off the field, and over any part.
Grippers, and the drawn arm between base and gripper, collide with nothing;
only motes collide.

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
entry above for `d - rotation` modulo `6`. The fixtures appear when a run
starts and vanish when it stops; `specs/field.md` states what a fixture does
and does not do.

A wheel is programmed like an arm, and its tape accepts only `rotate-cw` and
`rotate-ccw`; any other instruction faults, as `specs/simulation.md` defines.
It has no grippers, no length choice, and never holds anything.

## Track

A `track` is an ordered path of distinct hexes, `cells`, laid one hex at a
time in the editor. Consecutive cells are adjacent. A track is `closed` when
its last cell is adjacent to its first and the editor has joined them into a
loop, as `specs/editor.md` describes; otherwise it is open. A track of one
cell is legal and open.

An arm or wheel whose anchor hex is a cell of a track is mounted on that
track, though a wheel, accepting only rotations, never moves along one. The
`advance` instruction carries a mounted arm's base to the next cell of the
path and `recede` to the previous one; on a closed track both wrap between
the ends, and on an open track moving past either end faults. The held motes
travel with the base, as `specs/simulation.md` defines. Mounting is
positional: moving a track or an arm in the editor changes what is mounted.

## Rises and sets

A `rise` delivers one reagent and a `set` receives one product. Every
challenge lists its reagents and products, as `specs/formats.md` defines, and
the tray offers one `rise` per reagent and one `set` per product, each
placeable exactly once. A machine runs only when every rise and every set is
on the field, as `specs/editor.md` states.

A rise or set is placed at an anchor and rotation like any sigil, and its
footprint is its pattern's hexes placed at that pose: the molecule pattern for
a rise, and for a set the pattern plus, when the product repeats, the pattern
translated once by the repeat vector. What a rise spawns and what a set
consumes are defined in `specs/sigils.md`.

## Placement rules

A placement, whether by hand in the editor or through a loaded solution, is
legal exactly when all of the following hold. An illegal placement does not
happen; `specs/editor.md` says how the editor refuses one.

1. Every hex of the part is on the field: an arm or wheel's anchor, every
   cell of a track, and every footprint hex of a sigil, rise, or set.
2. Sigil footprints, rise and set footprints included, are pairwise disjoint,
   and no track cell lies on any of them.
3. No hex is a cell of two tracks, or of one track twice.
4. No two arms or wheels share an anchor hex. An arm or wheel's anchor may sit
   on a sigil footprint hex or on a track cell; sitting on a track cell is
   what mounts it.
5. Each rise and each set is placed at most once.
6. A track's consecutive cells are adjacent, and a closed track's last cell
   is adjacent to its first and its path holds at least three cells.

Grippers and spokes are not part of these rules: an arm's reach and a wheel's
fixture ring may extend off the field or over anything.

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

Cost is a score rather than a budget: nothing limits what a machine may spend,
and the finished machine's cost is one of the three metrics
`specs/simulation.md` records.

## Presentation is yours

How a part is drawn is the build's to design: the arms and their grippers, the
wheel and its ring, the track, and each sigil's engraving. What a player must
read at a glance:

1. Each part kind is identifiable on the field, and the twelve transforming
   sigils read apart from one another.
2. An arm's spokes, its length, and whether each gripper is holding are
   visible.
3. A sigil's footprint hexes are visible, and its distinguished hexes read
   apart where `specs/sigils.md` names roles for them.
4. A track's path reads as a path, and its two ends are visible when it is
   open.
5. A rise shows its reagent's pattern and a set shows its product's pattern,
   so a player can see what arrives and what is wanted without opening
   anything.
6. The selected part, and a drag's ghost with its legality, are visibly
   distinct, as `specs/editor.md` requires.
