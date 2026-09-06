# Wireworm — The node field

Nodes are the terrain of the board: capacitor components the worm winds through,
the player charges by fighting, and clears by shooting. This file defines what a
node is, what raises and lowers its charge, what removes it, how a new run lays
the starting field, and how that field grows and persists. The chain-arc
discharge a critical node sets off is in `specs/discharge.md`.

## Charge

Every node occupies one tile of the board and carries one value: its charge, a
whole number from `0` to `CHARGE_MAX` (`3`). Charge is the whole of a node's
state, and a tile is either empty or holds exactly one node.

| Charge | State |
| --- | --- |
| `0` | Inert |
| `1` | Low |
| `2` | Charged |
| `3` | Critical |

A node at charge `1` or above is a charged node, and charge `3` is critical.
`specs/assets.md` states which sprite frame is drawn for each state, and
`specs/overview.md` states what a player has to read from them.

Charge never changes on its own. It does not decay, it does not rise with time,
and nothing raises or lowers it except the events below.

## What raises a node's charge

A node gains one charge when the worm's head is blocked by it, capped at
`CHARGE_MAX`:

```
charge = min(CHARGE_MAX, charge + 1)
```

The rise happens on the step the block happens, once per block rather than
continuously while the worm touches the node. `specs/worm.md` states what blocks
a step. A worm turned by the side edge of the board or by a worm segment changes
no node's charge, and a worm dropping or diving into a tile a node stands on
leaves that node's charge exactly as it was.

The corruptor is the other route, and `specs/foes.md` states it.

## What a bolt does to a node

A bolt travels up its column and resolves against the first node, worm segment,
or foe in its path, as `specs/cursor.md` states. What it does to a node depends
on that node's charge:

| Charge struck | Result |
| --- | --- |
| `0` | The node is removed and its tile is left empty. |
| `1` | The node is left standing at charge `0`. |
| `2` | The node is left standing at charge `1`. |
| `3` | The node detonates, as `specs/discharge.md` states. |

A charged node is therefore cleared by knocking its charge down one bolt at a
time and removing it once it is inert, and a critical node is cleared by
detonating it instead. No bolt ever raises a node's charge.

A bolt that resolves against a worm segment standing on a tile a node also
occupies leaves that node's charge exactly as it was. The segment is what the
bolt struck.

## How the field grows

Every worm segment destroyed by a bolt leaves a fresh node at charge `0` on the
tile it died on. Where that tile already holds a node, no new node is laid and
the standing node keeps the charge it had. A segment destroyed by a discharge
leaves nothing, as `specs/discharge.md` states.

The dropper lays nodes as it falls, as `specs/foes.md` states.

## What removes a node

| Route | Stated in |
| --- | --- |
| A bolt into an inert node. | This file. |
| A detonation, including every node the chain reaches. | `specs/discharge.md` |
| A glitch eating the node on its tile. | `specs/foes.md` |

Nothing else removes a node.

## The starting field

A new run lays a scattering of nodes across the scatter rows, rows
`SCATTER_TOP_ROW` (`1`) through `SCATTER_BOTTOM_ROW` (`17`) inclusive, which
hold `680` tiles between them.

- The number of nodes laid is drawn uniformly from the whole numbers between
  `SCATTER_MIN_FRACTION` (`0.10`) and `SCATTER_MAX_FRACTION` (`0.15`) of those
  `680` tiles, which is `68` to `102`, both ends included.
- Every node of the scatter is laid at charge `0`.
- No node is laid in row `0`, which the worm enters along, and none in the player
  band, rows `18` and `19`.
- Each node is laid on a tile drawn uniformly from the scatter rows' tiles not yet
  holding one, so a run's starting field is a fresh scatter rather than one fixed
  layout, and two runs lay different fields.

## The field persists

The field is laid once, when a run starts, and it stands from there.

- Clearing a level does not reset it. The nodes standing when a level clears are
  the nodes standing when the next level's play begins, at the charges they held.
- Losing a life does not reset it. Every node and its charge survive the respawn
  unchanged, while the worms and the foes do not, as `specs/progression.md`
  states.
