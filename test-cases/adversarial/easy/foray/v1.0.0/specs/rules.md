# Foray — the rules

Foray is a territorial maze-raiding contest between two ant colonies, **Red**
(west) and **Blue** (east). You write the **controller** that drives one colony's
three agents. The controller runs on its own once compiled — there is no model in
the loop during a match — so all of the intelligence has to be in the code you
ship. Your opponent is another controller; the match decides the result.

This file is the game. Read it alongside `specs/contract.md` (how your controller
talks to the game), `specs/sandbox.md` (the per-tick limits), and
`specs/baselines.md` (the opponents you must beat).

## The board

The two colonies share one **mirror-symmetric maze** of dug tunnels, split down
the centre by a contested no-man's-land. Every wall, tunnel, seed cache, large
seed, and jelly node on one side has a mirror twin on the other, so neither colony
starts with a structural advantage.

- The shipped map is **`mirror-32x16`**: a `32 × 16` grid, with the border between
  columns **15 and 16** (`border_x = 16` is the first column belonging to Blue's
  half). Red holds columns `0..16`, Blue holds `16..32`.
- Movement is **tile-locked**: each agent occupies one tile and on each tick moves
  one tile **N / S / E / W** or holds (**Stop**). Walls block movement; the board
  edge blocks movement. Two agents may share a tile.
- The coordinate system is `(x, y)` with `x` increasing east and `y` increasing
  **south** (so `N` is `y - 1`, `S` is `y + 1`).

Four fixtures sit on the board:

- **Nests** — each colony has a spawn nest against its back wall. Agents start
  there and respawn there.
- **Seed caches** — the ordinary scorable resource: small piles of seeds spread
  across each colony's home half, mirrored between the halves (**14 caches per
  half** on the shipped map). A cache is worth **1** and is consumed when a raider
  eats it.
- **Large seeds** — **2 per half**, each worth **3**. They are not tiles, they are
  *objects*: they **move**. See [Large seeds](#large-seeds--the-moving-prize).
- **Royal jelly nodes** — **2 per half** power nodes. See
  [Royal jelly](#royal-jelly).

A half is therefore worth **20** in total: `14 × 1` from ordinary caches plus
`2 × 3` from large seeds.

Each side fields **three agents** (ids `0`, `1`, `2`). The agents are **not
typed** — every one is both an attacker and a defender depending on where it
stands (see [Roles flip at the border](#roles-flip-at-the-border)). Deciding, tick
by tick, who raids and who defends is your job.

## Roles flip at the border

The core rule is the **role flip**, and it is what makes each agent both an
attacker and a defender:

- An agent standing on **its own half** is a **soldier** (a defender).
- An agent standing on **the enemy half** is a **raider** (a forager). A raider
  **eats the enemy's seeds** and carries them.

An agent's role is decided **entirely** by which half it currently stands on —
crossing the border flips it. Your three agents are interchangeable; the
controller chooses who pushes across to raid and who stays home to defend, and may
change that assignment every tick.

The observation gives each agent's current `role` directly, so you never derive
it yourself — but understanding *why* it flips is the heart of the game.

## Eating, carrying, banking

- A **raider** that steps onto an enemy seed cache **eats** it, removing the cache
  from the board and adding **1** to its load. Stepping onto an enemy **large
  seed** picks it up whole, adding **3**.
- Your load is not yet score. A raider **banks** it by **carrying it back across
  the border** onto its own half. The instant it crosses, its **entire** load is
  added to the team's score and its load resets to zero.
- A raider **tagged before banking scores nothing** for what it was carrying. Its
  ordinary seeds scatter back onto the maze as recoverable caches, and any large
  seed it held **drops back onto the board whole** (see
  [Tagging and respawn](#tagging-and-respawn)).

So a seed only counts once it is **banked**. Eating is potential; banking is
points.

**Reaching home banks you before anything can kill you there.** Banking is settled
before tagging within a tick, so an agent that crosses the border with a load has
already scored by the time any enemy on the landing tile can act. Get across and
the points are yours.

## Tagging and respawn

Two enemies **meet** when they share a tile, **or** when they try to trade tiles
in the same tick (see [No slipping past a defender](#no-slipping-past-a-defender)).

Because a role is decided purely by which half a tile is on, a meeting is
*always* one **soldier** (whose half it is) against one enemy **raider**. There is
no other pairing. What happens turns only on **royal jelly**:

| | |
| --- | --- |
| **Neither is immune** | The **soldier tags the raider**. Home turf wins. |
| **Exactly one is immune** | The **immune one tags the other** — whichever it is. |
| **Both are immune** | **Nothing happens.** They pass the moment by. |

Put plainly: **an immune ant cannot be killed, and it kills any non-immune enemy
it meets.** Immunity is not merely a shield — it is a weapon.

A tagged ant **respawns at its nest**. A tagged **raider** also drops what it was
carrying: its ordinary seeds scatter onto the maze at the tag tile as recoverable
caches, and any large seed it held drops there **intact** — still one object,
still worth 3. Defending well does not just stop a raid; it hands the seeds back.

> **A soldier at home is no longer safe.** Under the old rules a defender on its
> own half could never be tagged. It can now: an enemy raider carrying active jelly
> will kill it. Do not station a defender somewhere and assume it will live.

## The twist

Foray changes the levers most capture-the-flag strategies lean on. All three
changes are native to the ant theme, and every constant is tunable — the shipped
values are below.

### Carry weight — the signature mechanic

A raider's speed **degrades with its load**, and an **unladen raider is slightly
faster than a soldier** — the Pac-Man edge over the ghosts, which is what lets a
colony break a defended line and make progress at all.

Movement uses a **speed accumulator** so speeds can be finer than one tile per
tick. Each agent earns a fixed amount of *movement charge* per tick and steps one
tile once it has banked a full tile's worth (`W = 8` charge, the **movement
resolution**). The charge earned per tick is the agent's **speed**:

- A **soldier** earns `7` per tick — just under the resolution, so it moves a
  shade under one tile per tick (it skips one step in every eight).
- A **light raider** — carrying a load of **at most 3** — earns the full `8`, so
  it moves **every tick**: the one-tile-per-tick cap, and strictly faster than a
  soldier.
- Past a load of 3, a raider loses `1` charge per extra unit of load, down to a
  floor of `1` (an over-loaded raider crawls but never freezes completely).

The number that drives this is **`load`**, not the number of objects you are
holding. A **large seed counts as 3** — it is worth 3 *and it weighs 3*.

| Load | Raider speed (charge/tick) | Versus a soldier (7) |
| --- | --- | --- |
| 0–3 | 8 | faster (moves every tick) |
| 4 | 7 | equal |
| 5 | 6 | slower by one |
| 6 | 5 | slower by two |
| 7 | 4 | half speed (every other tick) |
| 8 | 3 | … |
| 9 | 2 | … |
| 10+ | 1 (floor) | crawling |

Read the table against a large seed and the tension falls out. A raider carrying
**nothing but a large seed** sits at load 3 — still light, still outrunning every
defender, so the clean snatch-and-run works. Pick up **one more ordinary seed** and
you are at load 4: soldier speed, no edge, and probably caught.

This inverts the usual capture-the-flag question. Hoarding makes a raider slow and
easy to run down, and a tagged raider loses **everything** it carries. So **load
is both your score and your vulnerability**: *when to break off and bank* is a
real, continuous decision, not an afterthought.

The observation tells you, per owned agent, its `load` and whether it
`can_move_this_tick` — whether it has banked enough charge to step if you tell it
to. You never re-derive either. A move you submit for an agent that has not banked
a full step this tick is simply a no-op. (Because a soldier moves just under every
tick, even a soldier reads `can_move_this_tick = false` on its occasional skipped
step.)

### No slipping past a defender

Two agents may **share** a tile, so moving onto another agent is legal. The one
move that is **cancelled** is the swap that would dodge a tag: a **soldier and an
enemy raider** trying to exchange tiles in the same tick (each stepping onto where
the other just was). Neither moves.

But the two are then treated as having **met**, and the tagging rule above settles
it. With no jelly in play that means the defender **catches** the raider as it
tries to slip past. You can never get *through* a defender by trading places — to
get past one you must go around it, and trying to swap is how you die.

Any *other* head-on swap **resolves** — the two agents pass through each other.
Two **soldiers** meeting at the central seam, or two **raiders** passing as each
carries a load home, exchange tiles freely, because no tag is at stake.

### Large seeds — the moving prize

Each half holds **2 large seeds**, worth (and weighing) **3** apiece. They are the
only fixture on the board that **moves**, and everything interesting about them
follows from that.

- **They drift.** Every `D = 300` ticks a large seed walks **one tile** along a
  path through the maze, toward the border. **It drifts whether or not anyone is
  standing on it.** You cannot squat a large seed the way you can squat an ordinary
  cache — it simply walks out from under you.
- **Nothing but the border stops it.** It keeps walking until it cannot go further
  without crossing, and comes to rest on the **last column of its own half** —
  right on the seam. It never crosses on its own: a seed is *stolen by a raid*,
  never conceded by the clock.
- **So an ignored large seed becomes nearly free for the enemy.** A seed sitting on
  the seam is one step from an enemy raider, who can take it and bank it by
  stepping straight back home. Leaving it out there is a choice, and an expensive
  one.
- **Recall.** An ant of the seed's **own** colony that stands on it for
  `R = 150` **consecutive** ticks snaps it back to its spawn tile. Step off and the
  count resets — a recall has to be seen through in one stint. The cost is the walk
  out and the walk back, and an agent spent walking is an agent not raiding.
- **You cannot pin one at home.** A seed can only be recalled once it has drifted
  at least **3 tiles** of maze distance from its spawn. Standing on the spawn tile
  does nothing, and neither does camping the tile next to it and yanking the seed
  back the moment it arrives. You have to let it get out before you can pull it in.
- **A dropped large seed stays whole.** Tag a raider hauling one and it falls on
  the tag tile, deep in your own territory, still one object worth 3 — and starts
  drifting again from there. Running down a big-seed carrier is one of the best
  defensive plays in the game.

The observation lists every large seed with its position, its home tile, its value,
and `ticks_to_drift` — how long until it takes its next step. That last number is a
clock, not a suggestion.

### Royal jelly

Eating a **royal jelly** node grants **the eater** **immunity** for a window of
**`J = 40` ticks**. While it lasts:

- the immune ant **cannot be tagged** by anything, and
- the immune ant **tags any non-immune enemy it meets** — including a **soldier**
  standing safely on its own half.

That second clause is the one that changes the game. Jelly is how you punch a heavy
load home through a defended border, *and* how you break a defender who has parked
itself on something you want. A defender squatting a seed cache is untouchable
right up until a raider arrives with jelly running.

**A consumed node grows back.** After `jelly_respawn_ticks = 1200` it reappears at
**the same tile**, so the jelly layout is fixed for the whole match and the
positions are worth learning. Jelly is a **renewable** resource on a cycle, not a
pair of one-shot charges — which is exactly why a defender cannot hold a position
forever.

Note that immunity travels with the ant, not the role. A raider that eats jelly and
runs home is an **immune soldier** for the rest of its window.

The observation lists the active jelly nodes (a spent one drops out of the list and
returns when it regrows) and gives each agent's remaining `immune_ticks` — for your
own agents **and the enemy's**. An enemy with `immune_ticks > 0` is not a target;
it is a threat.

## Winning

A match ends the moment **either** condition is met:

- **Sweep — bank every seed from the enemy half.** As soon as one colony has banked
  the enemy half's **full value** — **20** on the shipped map — it has stripped the
  enemy larder and **wins immediately**, regardless of the score on its own side.
  This is the decisive win. Large seeds count toward it at their full 3, so you
  cannot sweep without taking both of them.
- **Time limit — the 10-minute cap.** A match is bounded to **10 minutes of game
  time**. The timestep is a fixed, faked **16 ms**, so the cap is **37,500 ticks**.
  If the time limit is reached first, the colony with the **higher banked score**
  wins.

A **level score** at the time limit is broken by **efficiency**: the win goes to the
colony that burned **less total fuel** over the match. Only a level score *and*
level fuel is a true draw. Being wasteful is a way to lose a game you drew.

A controller that crashes (traps), exhausts its per-tick fuel or memory, or emits
a contract-invalid action **forfeits** the match — see `specs/sandbox.md` and
`specs/contract.md`.

## The numbers (shipped defaults)

| Quantity | Value |
| --- | --- |
| Board | `32 × 16`, border between cols 15/16 (`border_x = 16`) |
| Agents per side | 3 (ids 0–2) |
| Ordinary seed caches per half | 14 (worth 1 each) |
| Large seeds per half | 2 (worth **and weighing** 3 each) |
| Total value per half | 20 |
| Royal jelly nodes per half | 2 |
| Movement resolution `W` | 8 charge per tile |
| Soldier speed | 7 charge/tick (just under one tile/tick) |
| Light raider speed | 8 charge/tick (every tick) for loads 0–3 |
| Carry penalty | −1 charge/tick per unit of **load** past 3, floored at 1 |
| Jelly immunity `J` | 40 ticks |
| Jelly respawn | 1,200 ticks (regrows at the same tile) |
| Large seed drift `D` | 1 tile per 300 ticks, toward the border |
| Large seed recall `R` | 150 consecutive ticks standing on it |
| Large seed recall guard | must have drifted ≥ 3 tiles from spawn |
| Timestep | 16 ms (fixed, faked) |
| Max ticks | 37,500 (10 minutes of game time) |

These constants are part of the game definition, not levers you can change. They
are listed so you can plan around them — chiefly the carry-weight speed curve, the
jelly cycle, and the large-seed drift clock, which are the three quantities good
play has to reason about.
