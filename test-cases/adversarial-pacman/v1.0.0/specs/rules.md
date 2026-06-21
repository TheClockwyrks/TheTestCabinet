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
the centre by a contested no-man's-land. Every wall, tunnel, seed cache, and jelly
node on one side has a mirror twin on the other, so neither colony starts with a
structural advantage.

- The shipped map is **`mirror-32x16`**: a `32 × 16` grid, with the border between
  columns **15 and 16** (`border_x = 16` is the first column belonging to Blue's
  half). Red holds columns `0..16`, Blue holds `16..32`.
- Movement is **tile-locked**: each agent occupies one tile and on each tick moves
  one tile **N / S / E / W** or holds (**Stop**). Walls block movement; the board
  edge blocks movement. Two agents may share a tile.
- The coordinate system is `(x, y)` with `x` increasing east and `y` increasing
  **south** (so `N` is `y - 1`, `S` is `y + 1`).

Three fixtures sit on the board:

- **Nests** — each colony has a spawn nest against its back wall. Agents start
  there and respawn there.
- **Seed caches** — the scorable resource: small piles of seeds spread across each
  colony's home half, mirrored between the halves (about **20 caches per half** on
  the shipped map). A cache is consumed when a raider eats it.
- **Royal jelly nodes** — a small number of power nodes per half (**2 per half** on
  the shipped map). See [Royal jelly](#royal-jelly).

Each side fields **three agents** (ids `0`, `1`, `2`). The agents are **not
typed** — every one is both an attacker and a defender depending on where it
stands (see [Roles flip at the border](#roles-flip-at-the-border)). Deciding, tick
by tick, who raids and who defends is your job.

## Roles flip at the border

The core rule is the **role flip**, and it is what makes each agent both an
attacker and a defender:

- An agent standing on **its own half** is a **soldier** (a defender). A soldier
  **tags** enemy raiders that are on its turf.
- An agent standing on **the enemy half** is a **raider** (a forager). A raider
  **eats the enemy's seed caches** and carries the seeds.

An agent's role is decided **entirely** by which half it currently stands on —
crossing the border flips it. Your three agents are interchangeable; the
controller chooses who pushes across to raid and who stays home to defend, and may
change that assignment every tick.

The observation gives each agent's current `role` directly, so you never derive it
yourself — but understanding *why* it flips is the heart of the game.

## Eating, carrying, banking

- A **raider** that steps onto an enemy seed cache **eats** it, removing the cache
  from the board and adding it to the raider's **carried load**. Carried seeds are
  **not yet scored**.
- A raider **banks** its load by **carrying it back across the border** onto its
  own half. The instant it crosses, the **entire** carried load is added to the
  team's score and the raider's load resets to zero.
- A raider that is **tagged before banking scores nothing** for what it was
  carrying — the load is dropped back onto the board (see
  [Tagging and respawn](#tagging-and-respawn)).

So a seed only counts once it is **banked**. Eating is potential; banking is
points.

## Tagging and respawn

- A **soldier** that shares a tile with an enemy **raider** on the soldier's own
  half **tags** it — whether the soldier moved onto the raider or the raider moved
  onto the soldier.
- A tagged raider **respawns at its nest**, and its carried load is **dropped onto
  the maze** at the tag location, scattering back into play as recoverable caches
  on the defender's territory. Defending well does not just stop a raid — it hands
  the seeds back to your side.
- Soldiers cannot be tagged on their own half. The **border itself is safe**: an
  agent is only ever a raider (and thus taggable) once it is fully across onto the
  enemy half.

## The twist

Foray changes the two levers most capture-the-flag strategies lean on. Both
changes are native to the ant theme, and both constants are tunable — the shipped
values are below.

### Carry weight — the signature mechanic

A raider's speed **degrades with its load**. A raider carrying `load` seeds moves
once every

```
1 + floor(load / W)        // shipped W = 3
```

ticks. Unladen (`load = 0`) it moves every tick; carrying `3` it moves every other
tick; carrying `6`, every third tick; and so on. **Soldiers always move every
tick** regardless of anything.

This inverts the usual question. Hoarding makes a raider slow and easy to run
down, and a tagged raider loses **everything** it carries. So **load is both your
score and your vulnerability**: *when to break off and bank* is a real, continuous
decision, not an afterthought. A controller that over-loads will bleed seeds to
defenders.

The observation tells you, per owned agent, whether it `can_move_this_tick` under
this cadence — you never re-derive it. A move you submit for an agent that is
stalling this tick is simply a no-op.

### Royal jelly — the inverted capsule

Eating a **royal jelly** node grants **the eater** **tag-immunity** for a window of
**`J = 40` ticks** (a scent-mask / adrenal surge). An immune raider **cannot be
tagged**, so jelly is how you punch a heavy load home through a defended border.

Jelly does **not** make soldiers edible, and there is no "hunt the scared
defenders" phase — this is the inverse of the classic power-capsule. Jelly is the
deliberate counter to carry weight: the risky tool that lets a slow, laden raider
survive the run home. The observation lists the active jelly nodes and gives each
owned agent's remaining `immune_ticks`.

## Winning

A match ends the moment **either** condition is met:

- **Sweep — bank every seed from the enemy half.** As soon as one colony has eaten
  and banked **all** of the other colony's seeds, it has stripped the enemy larder
  and **wins immediately**, regardless of the score on its own side. This is the
  decisive win.
- **Time limit — the 10-minute cap.** A match is bounded to **10 minutes of game
  time**. The timestep is a fixed, faked **16 ms**, so the cap is **37,500 ticks**.
  If the time limit is reached first, the colony with the **higher banked score**
  wins; an **equal** banked score is a **draw**.

A controller that crashes (traps), exhausts its per-tick fuel or memory, or emits
a contract-invalid action **forfeits** the match — see `specs/sandbox.md` and
`specs/contract.md`.

## The numbers (shipped defaults)

| Quantity | Value |
| --- | --- |
| Board | `32 × 16`, border between cols 15/16 (`border_x = 16`) |
| Agents per side | 3 (ids 0–2) |
| Seed caches per half | ~20 |
| Royal jelly nodes per half | 2 |
| Carry-weight divisor `W` | 3 — move every `1 + floor(load / 3)` ticks |
| Jelly immunity `J` | 40 ticks |
| Timestep | 16 ms (fixed, faked) |
| Max ticks | 37,500 (10 minutes of game time) |

These constants are part of the game definition, not levers you can change. They
are listed so you can plan around them — chiefly the carry-weight cadence and the
jelly window, which are the two quantities good play has to reason about.
