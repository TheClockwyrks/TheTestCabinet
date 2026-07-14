# Arc Foundry — The Build Loop

This file defines the **scrap-press build loop** — the signature of the game. Each
level you make a fixed number of **random** stamps from the press, and decide each
one's fate: **keep** it firing, **slag** it into an inert wall, or **combine** two
matches into a rarer component one quality tier higher. Every stamped component is
*also* a maze wall, so the **keep-vs-slag-vs-combine** decision — while keeping the
maze long and never sealing a segment — is the strategic heart of the game.

This builds on the components and their quality ladder in `specs/towers.md`, the
tile grid, the uniform footprint, and the waypoint pathing / never-seal / re-path
rules in `specs/board.md`, the economy (Charge, refunds, the pre-wave window) in
`specs/flow.md`, and the stamp / slag / combine / targeting controls in
`specs/controls.md`. Charge is the unitless money of `specs/flow.md`.

The numbers below are **fixed** for this version; implement them exactly as written.
Equally important is the **behavior**: builds are random and weighted low, the climb
is paid in rolls and not in money, and every stamp that is not kept firing still
**walls** the yard.

## The build loop in one paragraph

A **level** is one **build phase** plus the **wave** that follows it. At the start of
each build phase you get a fresh allowance of **7 press stamps**. Each stamp costs
**Charge**, drops a **random component of a random quality** onto a footprint you
position, and starts **active** — firing and walling. You then shape those stamps and
everything already on the board: keep the good rolls firing, **slag** the rest into
cheap wall, and **combine** any two matching components into one a tier higher — until
the yard is a maze the Load must crawl through and your firing line has climbed the
quality ladder. Do it wave after wave, thirty-odd times over, without ever fully
sealing a waypoint segment.

## Builds-per-level (fixed — constant across difficulty)

- Each level grants a fixed **builds-per-level = 7** press stamps.
- The allowance **refreshes** to 7 at the start of every build phase.
- You may spend stamps during the build phase **or** during the live wave, up to 7
  that level. **Unused stamps do not carry over** — an unspent stamp is lost when the
  next build phase refreshes the allowance.
- **Slagging, selling, and combining do not consume stamps** — only pulling the press
  does.
- Builds-per-level is **identical on Easy, Medium, and Hard**. Difficulty changes only
  the wave count and enemy toughness (`specs/modes.md`); the money rate and this
  allowance never change.

The panel's scrap-press control shows the remaining stamps of the 7-per-level
allowance and the per-stamp cost (`specs/controls.md`, `specs/flow.md`).

## The stamp — the random roll (fixed odds)

Pulling the press costs **18 Charge** and stamps **one** component of a **random
type** at a **random quality**. You cannot buy a chosen component at a chosen
quality — the press is the *only* way a component enters the board (aside from a
combine, below).

- **Type** — uniform, **20%** each:

  | Type | Odds |
  | --- | --- |
  | **Capacitor** | 20% |
  | **Coil** | 20% |
  | **Emitter** | 20% |
  | **Arc-Node** | 20% |
  | **Discharge Rig** | 20% |

- **Quality** — weighted **low**, so the climb comes from combining, not from lucky
  rolls:

  | Quality | Odds |
  | --- | --- |
  | **Scrap** (T1) | 62% |
  | **Tuned** (T2) | 24% |
  | **Charged** (T3) | 10% |
  | **Primed** (T4) | 3.4% |
  | **Tesla-Prime** (T5) | 0.6% |

Type and quality roll **independently**. A stamp costs 18 Charge whatever it rolls;
you can never go below 0 Charge, so the press is disabled when you cannot afford a
pull (`specs/flow.md`).

A freshly stamped component lands on a legal **2×2** footprint the player positions —
snapped to the grid, subject to the **never-seal rule** (a placement that would fully
block any waypoint segment, or trap a unit already walking, is refused;
`specs/board.md`). Once placed it starts **ACTIVE**: it fires per `specs/towers.md`
and it is a wall, and the floor **re-paths live** around its new footprint
(`specs/board.md`). A **build spark** VFX fires at the stamp site (`specs/assets.md`).

## The three fates

Every stamped component ends up as exactly **one** of three things. Choosing among
them, over and over, is the whole game.

### 1. Keep active

Leave the component as-is: it **fires** at its stats (`specs/towers.md`) **and** walls
its footprint. Keeping many low-quality components active is not overpowering — Scrap
damage is weak and DPS scales steeply with quality (`specs/towers.md`), so a board of
Scrap is a junkyard of pea-shooters. The board's power comes from **climbing** the
ladder, not from flooding it with cheap stamps. A kept component can still be slagged,
sold, or combined later.

### 2. Slag (inert wall)

At any time the player may **slag** an active component (`specs/controls.md`). It
becomes an inert **slag wall** — a fused lump of scrap that **walls but never fires**:
no range, no targeting, no head to rotate. Slagging **refunds a flat 12 Charge**
immediately (so a wall you never wanted firing nets ~6 Charge against its 18 stamp
cost).

Slag is the **cheap maze material**: pull 5, keep the good rolls firing, and slag the
rest into wall to lengthen the Load's route. A slag wall obeys the **never-seal rule**
like any other wall and can be **sold for 6 Charge** (`specs/flow.md`), which frees its
footprint and re-paths the floor. Slagging is a **one-way** conversion — a slag wall
never fires again; you rebuild a firing component only by stamping the press.

Slag reads as unmistakably inert (a fused-scrap lump with no firing head;
`specs/assets.md`) and drops a **slag thunk** sound when it forms (`specs/assets.md`).

### 3. Combine (climb the quality ladder — fixed recipe)

**Two matching components — the same TYPE and the same QUALITY — combine into one
component of that same type, one quality tier higher.**

- A match is enabled when the selected active component has **another active
  component of the same type and quality anywhere on the board**. The inspector then
  offers **COMBINE** (`specs/controls.md`); it is hidden when no match exists.
- Combining **consumes both** matching components and **produces** the higher-tier
  component **at the selected component's footprint**. The **other** footprint is
  **freed** (its tiles become Open), which **re-paths** the floor (`specs/board.md`).
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
is steep (`specs/towers.md`: `×2.2 / ×5.0 / ×11 / ×24` over Scrap), a combined
component **always out-DPSes the two it consumed** *and* frees a tile. So the tension
is never "is it worth combining" — it is **"do I have a match, and can I give up that
wall's position in my maze?"** A component you combine away stops walling its old
footprint, which can shorten the Load's route; sometimes the wall is worth more than
the tier.

**Only same-type, same-quality combines exist.** There are no cross-type "special"
combines and no five-unique recipes — those are out of scope. To climb, you match
type **and** quality.

## Invested value, and the pre-wave full-refund window

A component **carries** the Charge that made it (used by sells in `specs/flow.md`):

| Origin | Invested value |
| --- | --- |
| stamped from the press | **18** |
| a combine | the **sum of the two it consumed** — so `36 / 72 / 144 / 288` up the ladder |

Selling an active component refunds **70%** of its invested value; slagging refunds a
flat 12; a slag wall sells for 6 (`specs/flow.md`).

**Full-refund window.** A component **stamped, kept, or slagged during a build phase**
and **sold before that wave starts** refunds its **full** invested value — no 70% loss.
This makes the opening build (the untimed pre-Wave-1 phase, `specs/flow.md`) fully
re-shapeable: place, maze, tear down, and re-place your starting board at no cost until
the wave begins.

## How the loop drives the maze

Every one of the three fates leaves a **wall** except a combine (which frees one
footprint and leaves the produced component walling the other). So building always
tends to **lengthen** the Load's route between waypoints, never seal it
(`specs/board.md`). Read the **next-wave preview** (`specs/flow.md`), pull the press,
keep the rolls that answer the coming wave (`specs/enemies.md`), slag the rest into
maze, and combine your matches up the ladder — then send the wave. That between-wave
cycle, constrained by the 7-stamp allowance and the never-seal rule, is the game.
