# Arc Foundry — The Build Loop

This file defines the **scrap-press build loop** — the signature of the game, and a
faithful reskin of Gem Tower Defense. Each level you place a fixed number of
**rocks** from the scrap-press; **each rock reveals a random component the instant it
lands**, and then you **keep exactly one** of that level's rolls as a firing tower.
Every rock you do **not** keep stays on the yard as an inert **blocker** — a wall that
shapes the maze but never fires. Keeping the maze long, choosing which single roll to
keep, and climbing the quality ladder by **combining** matches is the strategic heart
of the game.

This builds on the components and their quality ladder in `specs/towers.md`, the tile
grid, the uniform footprint, the waypoint zones, and the waypoint pathing / never-seal
/ re-path rules in `specs/board.md`, the economy (Charge, the untimed build phase) in
`specs/flow.md`, and the stamp / keep / combine / upgrade-quality / targeting controls
in `specs/controls.md`. Charge is the unitless money of `specs/flow.md`.

The numbers below are **fixed** for this version; implement them exactly as written.
Equally important is the **behavior**: the roll happens **on placement**, you may only
**keep one** roll per level, everything else becomes a blocker, and the climb is paid
in rolls and quality-refinement, not in flooding the board.

## The build loop in one paragraph

A **level** is one **build phase** plus the **wave** that follows it. At the start of
each build phase you get a fresh allowance of **5 rock stamps**. You pull the press to
put a **rock** on the cursor and drop it on the yard; **the moment it lands it rolls a
random component type at a random quality** and becomes a **candidate** you can inspect
— but nothing is yours yet. Place up to five, compare their rolls, then **KEEP** the
single best as a firing component (or **COMBINE** a matched pair up a tier — combining
is that level's keep). When you **send the wave**, the kept roll becomes a permanent
firing component and **every rock you did not keep hardens into an inert blocker** that
walls the yard but never fires. Do that level after level, thirty-odd times over,
spending kill income on **UPGRADE QUALITY** to bias your rolls upward, and walling the
Load into an ever-longer maze it must crawl through — without ever fully sealing a
waypoint segment.

## Rocks, candidates, blockers, and components

Four things live in the build loop; all occupy the uniform **2×2** footprint
(`specs/board.md`) and all except the held rock are **walls**:

- **Rock (held)** — a blank rock on the cursor after you pull the press. It has **no
  type or quality yet** and is not on the board. Cancelling it costs nothing.
- **Candidate** — a rock **after it lands**: it has rolled a random type + quality
  (revealed in the inspector), walls its footprint, and is eligible to be **kept** or
  **combined** *this level only*. Candidates exist only during the build phase.
- **Blocker** — a candidate you did **not** keep, hardened at wave start into an inert
  wall: it blocks pathing forever but **never fires**, has no range, targeting, or
  head. Blockers are the cheap maze material. A future stamp may be dropped **onto a
  blocker** to reroll it back into a candidate (see below).
- **Component** — a candidate you **kept** (or a combine result): it **fires** at its
  stats (`specs/towers.md`) **and** walls. Permanent.

Blockers and components (and candidates) all block pathing identically; the difference
is that only a component fires, and only a candidate can be kept or combined.

## Builds-per-level (fixed — constant across difficulty)

- Each level grants a fixed **builds-per-level = 5** rock stamps.
- The allowance **refreshes** to 5 at the start of every build phase. **Unused stamps
  do not carry over.**
- The allowance is a **hard cap of five placements per level** — it is **not** a
  function of your Charge. Having more Charge than five stamps cost never lets you
  place a sixth; having too little Charge for the next stamp disables the press until
  you can afford it, but the cap is still five.
- Building — pulling the press, keeping, combining, and upgrading quality — happens
  **only during the build phase**, not during a live wave (`specs/flow.md`).
- Builds-per-level is **identical on Easy, Medium, and Hard**. Difficulty changes only
  the wave count and enemy toughness (`specs/modes.md`).

The panel's scrap-press control shows the **remaining stamps of the 5-per-level
allowance** and the per-stamp Charge cost (`specs/controls.md`, `specs/flow.md`).

## The stamp — a rock that rolls on placement (fixed odds)

Pulling the press puts a blank **rock** on the cursor. **The roll happens when the rock
lands, not when you pull the press** — so there is no way to see a roll, cancel, and
re-pull for a better one. Placing a rock costs **10 Charge**, spends **one** of the
five stamps, and rolls **one** component of a **random type** at a **random quality**
at the footprint where it lands. The press is the only way a component enters the board
(aside from a combine, below).

- **Type** — uniform, **20%** each: Capacitor, Coil, Emitter, Arc-Node, Discharge Rig.

- **Quality** — weighted **low**, and biased upward by your **Refinement level**
  (`UPGRADE QUALITY`, below). A single stamp **never rolls above Charged (T3)** —
  **Primed (T4) and Tesla-Prime (T5) are reached only by combining** (below), so the
  apex is always earned by climbing, never handed out by a lucky roll. At Refinement
  **R0** the odds are:

  | Quality | R0 odds |
  | --- | --- |
  | **Scrap** (T1) | 72% |
  | **Tuned** (T2) | 26% |
  | **Charged** (T3) | 2% |
  | **Primed** (T4) | 0% (combine only) |
  | **Tesla-Prime** (T5) | 0% (combine only) |

Type and quality roll **independently**. A stamp costs 10 Charge whatever it rolls; you
can never go below 0 Charge, so the press is disabled when you cannot afford a pull or
the allowance is spent (`specs/flow.md`).

### Placement, continuous placement, and cancelling

A held rock is positioned on a legal **2×2** footprint the player snaps to the grid,
subject to the placement legality and **never-seal** rule of `specs/board.md` (a
placement that would fully block any waypoint segment, trap a unit, or land on a
**waypoint-zone** tile or a fixed housing is refused). Left-click a legal footprint to
drop it: it lands, **rolls its component**, becomes a **candidate** firing a **build
spark** VFX (`specs/assets.md`), and the floor **re-paths live** around its footprint.

- **Continuous placement.** Placing a rock does **not** clear your hand: if stamps and
  Charge remain, the press immediately arms **another** rock on the cursor, so you place
  five back-to-back without re-clicking STAMP each time. Placement ends when the
  allowance or Charge runs out, or you cancel.
- **Cancel is free.** Pressing `Esc` / right-click while holding a rock puts it away
  with **no Charge spent and no stamp consumed** — because the roll only happens on a
  successful drop, cancelling never wastes a build.
- **Stamp onto a blocker.** Dropping a rock onto an existing **blocker's** footprint
  **rerolls that blocker into a fresh candidate** (spending a stamp + Charge as normal).
  This is how you turn a wall you built earlier into a tower: spend a stamp on it, roll
  it, and keep it if it is good.

## Keep exactly one per level

After placing (up to five) candidates, you **KEEP** the single best as a permanent
firing component. **Only one component may be kept per level.**

- Select a candidate to inspect its rolled type, quality tier, and live stats
  (`specs/controls.md`), then click **KEEP** (or press `K`) to mark it as this level's
  kept roll. The kept candidate is highlighted on the board.
- The keep choice is **reversible until you send the wave**: choosing KEEP on a
  different candidate **moves** the choice; only one candidate is ever the kept one.
- **Combining is the alternative to keeping** (below): a combine you set this level is
  the level's single commit instead of a plain keep.
- You may also keep **nothing** — a level where every rock becomes a blocker (a pure
  maze-building level). That is legal but adds no firepower, so it cannot be the whole
  strategy.

### What happens at wave start

When you **SEND** the wave (`specs/controls.md`):

1. The **kept** candidate becomes a permanent firing **component** (or, if you set a
   combine, the combine resolves — below).
2. **Every remaining candidate hardens into a blocker** — an inert wall for the rest of
   the run.
3. Candidates and the keep/combine choice are cleared; the wave begins.

So each level adds **at most one** firing component to your line, and leaves the rest of
the level's rocks as maze. The board's power comes from *which* rolls you keep, climbing
their quality, and lengthening the maze — never from keeping a whole level's worth of
towers.

## Combine — climb the quality ladder (build phase only, fixed recipe)

**Two matching components — the same TYPE and the same QUALITY — combine into one
component of that same type, one quality tier higher.** In this game combine is a
**build-phase action** and it **is that level's keep**: like KEEP, performing a combine
is the single thing you harvest from the level.

- Select a **candidate** whose type + quality matches **another candidate** or an
  **existing permanent component** anywhere on the board. The inspector then offers
  **COMBINE** (`specs/controls.md`); it is hidden when no match exists, when a wave is
  live, or when the candidate is already Tesla-Prime.
- Choosing COMBINE sets this level's harvest to that pair (reversible until send, like
  KEEP). When you **send the wave** it resolves: it **produces** the higher-tier
  component **at the candidate's footprint** and **consumes the partner** — freeing the
  partner's footprint (its tiles become Open, which **re-paths** the floor,
  `specs/board.md`) if the partner was a separate structure.
- Combining **costs no Charge** — the climb is paid in rolls, not money.
- A **combine flash** VFX fires as the tier climbs (`specs/assets.md`), with a combine
  chime (`specs/assets.md`).

The recipe by rung (same type throughout):

| Combine | Produces |
| --- | --- |
| two **Scrap** (T1) | one **Tuned** (T2) |
| two **Tuned** (T2) | one **Charged** (T3) |
| two **Charged** (T3) | one **Primed** (T4) |
| two **Primed** (T4) | one **Tesla-Prime** (T5) |

**Tesla-Prime (T5) is the apex and cannot combine further.** Because the damage curve
is steep (`specs/towers.md`: `×3 / ×9 / ×40 / ×110` over Scrap) and Primed/Tesla-Prime
are **combine-only**, a combined component **always out-DPSes the two it consumed** — and
combining is the *only* way to reach the top two tiers. Combining a fresh candidate into
an existing
component is how you keep a single position and climb its tier level after level; the
question is whether you rolled a match this level and want to spend your one keep on the
climb instead of a new tower.

**Only same-type, same-quality combines exist.** There are no cross-type "special"
combines and no five-unique recipes — those are out of scope.

## UPGRADE QUALITY — the Refinement track

The other place kill income goes is **refining the press** so it rolls stronger gems —
the game's second progression axis beside combining.

- A run carries a **Refinement level `R`** on a six-rung track **R0 … R5** (starts at
  **R0**). Higher `R` biases the stamp's **quality** roll toward higher tiers; it does
  **not** change the uniform 20%-per-type roll, the stats, the combine recipe, or
  anything else.
- The build panel's **UPGRADE QUALITY** control (`specs/controls.md`, hotkey `U`) buys
  the next Refinement level for **Charge**. It is disabled at **R5** or when you cannot
  afford the next cost. Refinement is permanent for the run.

Quality odds by Refinement level (each row is a T1–T3 distribution that sums to 1.0;
**T4 and T5 are always 0 — Primed and Tesla-Prime come only from combining** —
**fixed**):

| R | Scrap T1 | Tuned T2 | Charged T3 | Primed T4 | Tesla T5 |
| --- | --- | --- | --- | --- | --- |
| **R0** | 0.72 | 0.26 | 0.02 | 0 | 0 |
| **R1** | 0.55 | 0.36 | 0.09 | 0 | 0 |
| **R2** | 0.40 | 0.42 | 0.18 | 0 | 0 |
| **R3** | 0.28 | 0.44 | 0.28 | 0 | 0 |
| **R4** | 0.18 | 0.44 | 0.38 | 0 | 0 |
| **R5** | 0.10 | 0.42 | 0.48 | 0 | 0 |

Refinement cost to reach each level (Charge, from the previous level) — **fixed**:

| Reach | R1 | R2 | R3 | R4 | R5 |
| --- | --- | --- | --- | --- | --- |
| **Cost** | 55 | 110 | 200 | 340 | 520 |

Refining and combining are complementary: refine so the press hands out more **Charged**
base rolls, then combine matched Charged into the **Primed** and **Tesla-Prime** carries
the press will never roll on its own.

## How the loop drives the maze

Every rock you place — kept or not — **walls** its footprint, and only a combine ever
frees a footprint (the consumed partner's). So building always tends to **lengthen** the
Load's route between waypoints, never seal it (`specs/board.md`). Read the **next-wave
preview** (`specs/flow.md`), place your five rocks to both extend the maze and fish for a
good roll, keep the one that best answers the coming wave (`specs/enemies.md`), let the
rest harden into blockers, and spend banked Charge on UPGRADE QUALITY to lift your future
rolls — then send. That build-phase cycle, constrained by the 5-stamp allowance, the
one-keep rule, and the never-seal rule, is the game.
