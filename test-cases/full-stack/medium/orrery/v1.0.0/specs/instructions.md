# Orrery — Instructions and tapes

This file defines the program a machine runs: the instruction set, the tape
each arm and wheel carries, the period the tapes loop on, and the two editor
macros that write instructions in bulk. How a tape is edited is in
`specs/editor.md`, and what each instruction does to the field, including
every fault it can raise, is in `specs/simulation.md`.

## The instruction set

`INSTRUCTIONS` holds the ten instructions. A tape cell holds one of them or is
blank.

| Instruction | Meaning |
| --- | --- |
| `grab` | Every gripper closes. A gripper over a mote takes hold of that mote's constellation, as `specs/simulation.md` states. |
| `drop` | Every gripper opens, releasing whatever it held. |
| `rotate-cw` | The part turns one 60 degree step clockwise about its base. |
| `rotate-ccw` | The same, counterclockwise. |
| `pivot-cw` | Each held constellation turns one 60 degree step clockwise about the gripper holding it. |
| `pivot-ccw` | The same, counterclockwise. |
| `extend` | A piston's length rises by one. |
| `retract` | A piston's length falls by one. |
| `advance` | A mounted part's base moves to the next cell of its track. |
| `recede` | The same, to the previous cell. |

A blank cell is a rest: the part holds its pose for the cycle, keeping
whatever grip it has.

A wheel executes only `rotate-cw` and `rotate-ccw`; `extend` and `retract`
belong to the `piston` alone; and `advance` and `recede` need the part to be
mounted on a track. Any tape may carry any instruction, and an instruction the
executing part cannot perform faults the run at the moment it is fetched, as
`specs/simulation.md` defines.

## Tapes and the period

Every arm and wheel carries a tape: a row of cells indexed from `0`, each
blank or holding one instruction. A tape's length is the index of its last
non-blank cell plus one, and `0` when it is entirely blank.

The machine's period `P` is the largest tape length across its arms and
wheels, and `1` when every tape is empty. On cycle `c`, counted from `0`, each
part executes the cell at index `c` modulo `P` of its own tape, blank cells
included; a cell at or past the tape's own length is blank.

## The two macros

`reset` and `repeat` are editor macros rather than instructions: invoking one
writes plain instructions into the tape at the cursor, as `specs/editor.md`
describes. Both are computed from the arm's own tape alone.

For `reset`, the arm's pose at a cell is the pose reached by executing cells
`0` up to that cell once from the rest pose, ignoring faults and other parts:
rotation steps its direction, `extend` and `retract` step its length, clamped
to `ARM_MIN_LEN` (`1`) and `ARM_MAX_LEN` (`3`) rather than faulting, and
`advance` and `recede` step its track cell, wrapping only on a closed track and
stopping at the end of an open one.

### `reset`

Invoked at a cell, `reset` overwrites the cells from that cell onward with the
sequence that returns the arm from its pose at that cell to its rest pose, in
this order:

1. `drop`, always, as the first instruction.
2. `retract` repeated while the length is above the rest length, or `extend`
   repeated while it is below.
3. `rotate-cw` or `rotate-ccw`, repeated, whichever direction reaches the rest
   rotation in fewer steps. A tie of three steps is written as `rotate-cw`.
4. `advance` or `recede`, repeated, whichever direction reaches the rest cell
   in fewer steps along the track, wrapping counted on a closed track. A tie
   is written as `advance`.

An arm already at rest writes `drop` alone. Invoked on a wheel's tape,
`reset` writes step 3 alone, the shorter rotation run, and nothing when the
wheel is already at its rest rotation.

### `repeat`

Invoked at a cell, `repeat` copies the arm's own cells from index `0` up to but
not including that cell, blanks included, and overwrites the cells from that
cell onward with the copy. Invoked at cell `0` it writes nothing.
