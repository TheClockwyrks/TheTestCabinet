# Arc Foundry — The scrap-press

The scrap-press is how every structure enters the yard. This file fixes the four things
that occupy the grid, the stamp allowance, the roll a placed rock takes, the one harvest
each level yields, the two kinds of combine, dismantling, and the refinement track that
biases the roll. Where a structure may be placed is in `specs/yard.md`, the stats each
component carries are in `specs/components.md`, and the recipes are in
`specs/combinations.md`.

## The four things

| Thing     | Occupies the grid            | Walls | Fires | Harvestable          |
| --------- | ---------------------------- | ----- | ----- | -------------------- |
| Rock      | No, it is held on the cursor | No    | No    | No                   |
| Candidate | Yes                          | Yes   | No    | Yes, this level only |
| Blocker   | Yes                          | Yes   | No    | No                   |
| Component | Yes                          | Yes   | Yes   | Already harvested    |

- A rock is blank. It has no type and no quality until it lands.
- A candidate is a rock that has landed and rolled. It shows its type and quality in the
  inspector and can be kept, downgraded, or folded into a combine. Candidates exist only
  during a build phase.
- A blocker is an inert wall. It has no type, no quality, no range, no head, and no
  targeting. A stamp dropped onto a blocker rerolls it.
- A component is a candidate that was harvested, or the result of a combine. It is
  permanent.

All three of the placed things block pathing identically. A combination tower is a
component for every rule in this file except the ones that name it.

## The stamp allowance

- Each build phase grants `STAMPS_PER_LEVEL` (`5`) rock stamps.
- The allowance refreshes to `5` at the start of every build phase. Unused stamps do not
  carry over.
- Placing a rock is free. Charge is never spent on a stamp, so the allowance is the only
  limit on how many rocks a level places.
- The allowance is the same at every difficulty.

Pulling the press, placing a rock, keeping, downgrading, and dismantling are build-phase
actions. Combining standing components, refining the press, and upgrading a combination
tower are available in every phase, including during a live wave.

## The roll

A rock rolls the instant it lands, not when the press is pulled. Placing it spends one
stamp and rolls one component of a random type at a random quality at the footprint it
landed on. Type and quality roll independently.

| Axis    | Distribution                                                                                |
| ------- | ------------------------------------------------------------------------------------------- |
| Type    | Uniform over the eight base types, `0.125` each. Refinement does not change it.             |
| Quality | The five-tier distribution `REFINEMENT_ODDS[R]` for the run's current refinement level `R`. |

At refinement `R0` the press rolls Scrap alone. The full odds table is under Refinement
below.

### Placing a rock

A held rock is positioned as its `2` by `2` footprint, snapped to the grid under the
pointer, and dropped onto a footprint the placement conditions of `specs/yard.md` permit.
The drop lands the rock, rolls its component, makes it a candidate, and recomputes the
route.

- Continuous placement. A drop does not clear the hand: while stamps remain, the press
  arms another rock on the cursor immediately, so five rocks are placed back to back.
  Placement ends when the allowance is spent or the player cancels.
- Cancelling is free. Putting a held rock away spends no stamp, because the roll happens
  only on a successful drop.
- Rerolling a blocker. Dropping a rock onto the footprint of an existing blocker spends a
  stamp, removes the blocker, and lands a fresh candidate on those tiles.

## The harvest

Each level yields exactly one new firing structure, and committing that harvest is what
starts the wave. There is no separate send control, and a level cannot advance without a
harvest.

Three actions are a harvest:

| Action                                         | What it produces                                                                               |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| KEEP                                           | The selected candidate becomes a permanent component at its rolled type and quality.           |
| DOWNGRADE                                      | The selected candidate becomes a permanent component at one quality tier lower than it rolled. |
| A combine that consumes at least one candidate | The combine's result becomes a permanent component.                                            |

Committing a harvest resolves in this order:

1. The harvest resolves into one permanent structure.
2. Every remaining candidate hardens into a blocker for the rest of the run.
3. The wave begins.

DOWNGRADE applies to a candidate at Tuned or above. A Scrap candidate, a standing
component, a combination tower, and a blocker cannot be downgraded. It costs no Charge.

## Combining

A combine resolves the instant it is committed and costs no Charge. Both kinds are
wall-neutral: every footprint a combine consumes hardens into a blocker rather than being
freed, so a combine never opens a hole in the maze. The result lands at the footprint of
the piece the combine was initiated from, so a combine may replace a standing structure
in place.

What a combine consumes decides the phase:

| Ingredients              | Kind                | Effect on the phase                    |
| ------------------------ | ------------------- | -------------------------------------- |
| At least one candidate   | The level's harvest | Resolves, then starts the wave.        |
| Standing structures only | A plain combine     | Resolves and leaves the phase running. |

A plain combine is the only combine available during a live wave, since candidates exist
only in a build phase. A build phase hosts at most one harvest combine, because the wave
begins the moment it fires.

### Choosing the ingredients

- With an explicit combine set, the combine folds exactly the pieces in that set.
- With no explicit set, the game resolves the ingredients itself from the yard, and it
  consumes a candidate in preference to a standing structure wherever either would
  satisfy the fold.
- Every base structure that could combine right now, because it has a matching partner or
  completes a reachable recipe, is marked on the yard at all times without needing to be
  selected. Selecting a piece marks the exact set it would fold more strongly.

### Quality-combine

Two base structures of the same type and the same quality fold into one structure of that
type one tier higher.

| Folding     | Produces        |
| ----------- | --------------- |
| Two Scrap   | One Tuned       |
| Two Tuned   | One Charged     |
| Two Charged | One Primed      |
| Two Primed  | One Tesla-Prime |

A quality-combine is offered on a base structure that has a matching partner anywhere on
the yard, and on nothing else. Tesla-Prime is the top rung and offers no quality-combine.
A quality-combine only ever folds a same-type, same-quality pair.

### Recipe-combine

A recipe-combine folds the exact multiset of base `(type, quality)` ingredients a
combination tower's recipe demands into that tower. `specs/combinations.md` holds the
twelve recipes.

- The ingredients are candidates, standing base components, or a mix, and the piece the
  combine is initiated from is one of them.
- The tower lands at the initiating piece's footprint, at level `0`.
- Every consumed footprint hardens into a blocker.
- A combination tower is never an ingredient.

The inspector offers one action per reachable recipe, naming the tower each would build.

## Dismantling

Dismantling removes a structure, clears its four tiles back to Open, and recomputes the
route. It is a build-phase action and it returns nothing: no Charge, and no stamp, for
any structure including a candidate placed the same phase.

## Refinement

Refinement biases the press's quality roll. A run carries a refinement level `R` on the
nine-rung track `R0` through `R8`, at `REFINEMENT_MAX` (`8`), and starts at `R0`.
Refinement is permanent for the run and changes nothing but the quality distribution.

`REFINEMENT_ODDS` holds one five-tier distribution per level, each summing to `1`:

| `R` | Scrap  | Tuned  | Charged | Primed | Tesla-Prime |
| --- | ------ | ------ | ------- | ------ | ----------- |
| `0` | `1.00` | `0.00` | `0.00`  | `0.00` | `0.00`      |
| `1` | `0.70` | `0.30` | `0.00`  | `0.00` | `0.00`      |
| `2` | `0.60` | `0.30` | `0.10`  | `0.00` | `0.00`      |
| `3` | `0.50` | `0.30` | `0.20`  | `0.00` | `0.00`      |
| `4` | `0.40` | `0.30` | `0.20`  | `0.10` | `0.00`      |
| `5` | `0.30` | `0.30` | `0.30`  | `0.10` | `0.00`      |
| `6` | `0.20` | `0.30` | `0.30`  | `0.20` | `0.00`      |
| `7` | `0.10` | `0.30` | `0.30`  | `0.30` | `0.00`      |
| `8` | `0.00` | `0.30` | `0.30`  | `0.30` | `0.10`      |

`REFINEMENT_COSTS` holds the Charge cost of reaching each level from the one below it:

| Reaching | `R1` | `R2` | `R3` | `R4`  | `R5`  | `R6`  | `R7`  | `R8`  |
| -------- | ---- | ---- | ---- | ----- | ----- | ----- | ----- | ----- |
| Cost     | `20` | `50` | `80` | `110` | `140` | `170` | `200` | `230` |

Refining is available in every phase, including during a live wave. It is refused at `R8`
and when the player cannot afford the next level.
