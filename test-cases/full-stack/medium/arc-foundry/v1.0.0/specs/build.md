# Arc Foundry — The Build Loop

This file defines the **scrap-press build loop** — the signature of the game, and a
faithful reskin of Gem Tower Defense. Each level you place a fixed number of
**rocks** from the scrap-press; **each rock reveals a random component the instant it
lands**, and then you **keep exactly one** of that level's rolls as a firing tower.
Every rock you do **not** keep stays on the yard as an inert **blocker** — a wall that
shapes the maze but never fires. Keeping the maze long, choosing which single roll to
keep, climbing the quality ladder by **combining** matches, and assembling multi-part
**combination towers** from a recipe of rolls is the strategic heart of the game.

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
— but nothing is yours yet. Place up to five, compare their rolls, then take the level's
**one harvest**: **KEEP** the single best as a firing component, **QUALITY-COMBINE** a
matched pair up a tier, or **RECIPE-COMBINE** a set of rolls into a **combination tower**.
When you **send the wave**, that harvest resolves into a permanent firing component and
**every rock you did not harvest hardens into an inert blocker** that walls the yard but
never fires. Do that level after level, dozens of times over, spending kill income on
**UPGRADE QUALITY** to bias your rolls upward, and walling the Load into an ever-longer
maze it must crawl through — without ever fully sealing a waypoint segment.

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

- **Type** — uniform, **12.5%** each (`1/8`), across the **eight** base component types:
  Capacitor, Coil, Emitter, Arc-Node, Discharge Rig, Choke, Rectifier, Regulator
  (`specs/towers.md`). The type roll is independent of your Refinement level.

- **Quality** — weighted **low**, and biased upward by your **Refinement level**
  (`UPGRADE QUALITY`, below). A single stamp **never rolls above Charged (T3)** —
  **Primed (T4) and Tesla-Prime (T5) are reached only by combining** (below), so the
  apex is always earned by climbing, never handed out by a lucky roll. At Refinement
  **R0** the press rolls **only Scrap** — every base component starts a run as crude
  salvage, exactly like a fresh GemTD level-1 gem, and the whole quality ladder is
  climbed from there:

  | Quality | R0 odds |
  | --- | --- |
  | **Scrap** (T1) | 100% |
  | **Tuned** (T2) | 0% |
  | **Charged** (T3) | 0% |
  | **Primed** (T4) | 0% (combine only) |
  | **Tesla-Prime** (T5) | 0% (combine only) |

Type and quality roll **independently**. A stamp costs 10 Charge whatever it rolls; you
can never go below 0 Charge, so the press is disabled when you cannot afford a pull or
the allowance is spent (`specs/flow.md`).

The **current quality odds** for the live Refinement level must be **visible in the
scrap-press UI** so the player can read the probability of each quality tier before
placing a rock, and see how buying **UPGRADE QUALITY** shifts them (`specs/board.md`,
`specs/controls.md`).

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

## One harvest per level

After placing (up to five) candidates, you take the level's **single harvest** — the one
thing you carry out of the build phase as firepower. That harvest is **exactly one** of:

- **KEEP** a candidate — mark the single best roll to become a permanent firing
  component; or
- **QUALITY-COMBINE** a match — fold a matched pair one quality tier higher (below); or
- **RECIPE-COMBINE** a set — assemble a **combination tower** from a recipe of rolls
  (below).

**Only one harvest may be taken per level**, and any of the three is that harvest.

- Select a candidate to inspect its rolled type, quality tier, and live stats
  (`specs/controls.md`), then click **KEEP** (or press `K`) to mark it as this level's
  kept roll. The kept candidate is highlighted on the board.
- The harvest choice is **reversible until you send the wave**: choosing KEEP on a
  different candidate **moves** the choice; setting a combine (either kind) **replaces**
  a keep, and vice versa; only one harvest is ever set.
- When a combine (either kind) is available or committed, the pieces that will **fold
  together** are marked on the board with a **pulsing highlight** so the player can see
  exactly what merges — the eligible partners a selected candidate *could* combine with,
  and, once committed, the exact partner(s) the harvest *will* consume (`specs/controls.md`).
- **Combining — of either kind — is the alternative to keeping** (below): a combine you
  set this level is the level's single commit instead of a plain keep.
- You may also harvest **nothing** — a level where every rock becomes a blocker (a pure
  maze-building level). That is legal but adds no firepower, so it cannot be the whole
  strategy.

### What happens at wave start

When you **SEND** the wave (`specs/controls.md`):

1. The level's **harvest** resolves: the **kept** candidate becomes a permanent firing
   **component**, or — if you set a combine — the **quality-combine** or **recipe-combine**
   resolves (below).
2. **Every remaining candidate hardens into a blocker** — an inert wall for the rest of
   the run.
3. Candidates and the harvest choice are cleared; the wave begins.

So each level adds **at most one** firing component to your line — a kept roll, a
quality-climbed tower, or a combination tower — and leaves the rest of the level's rocks
as maze. The board's power comes from *which* rolls you harvest, climbing their quality,
assembling combos, and lengthening the maze — never from keeping a whole level's worth of
towers.

## Combining — two paths (build phase only)

There are **two** ways to combine, and each **is that level's single harvest** (the
alternative to a plain KEEP): the **quality-combine**, which climbs the quality ladder,
and the **recipe-combine**, which assembles a **combination tower**. Both are
build-phase actions, both cost **no Charge**, and both are **wall-neutral** — every
footprint they consume hardens into a blocker rather than being freed, so a combine
**never opens a hole** in the maze (`specs/board.md`).

## Quality-combine — climb the quality ladder (fixed recipe)

**Two matching components — the same TYPE and the same QUALITY — combine into one
component of that same type, one quality tier higher.** This is the **quality-combine**;
like KEEP, performing it is the single thing you harvest from the level.

- Select a **candidate** whose type + quality matches **another candidate** or an
  **existing permanent component** anywhere on the board. The inspector then offers a
  **quality-combine COMBINE** (`specs/controls.md`); it is hidden when no match exists,
  when a wave is live, or when the candidate is already Tesla-Prime.
- Choosing it sets this level's harvest to that pair (reversible until send, like
  KEEP). When you **send the wave** it resolves: it **produces** the higher-tier
  component **at the candidate's footprint** and **consumes the partner** — but the
  partner's 2×2 footprint **hardens into an inert blocker** rather than being freed, so
  the maze wall is preserved and a combine **never opens a hole** (`specs/board.md`,
  `specs/towers.md`). A quality-combine is therefore wall-neutral: both footprints stay
  walls.
- Quality-combining **costs no Charge** — the climb is paid in rolls, not money.
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
question is whether you rolled a match this level and want to spend your one harvest on
the climb instead of a new tower.

A quality-combine only ever folds a **same-type, same-quality** pair; cross-type
folding belongs to the **recipe-combine** below, not here.

## Recipe-combine — assemble a combination tower

Beside the quality climb, the press feeds a second combine path: a **recipe** folds a
specific **multiset of base `(type, quality)` ingredients** into one unique
**combination tower**. This is GemTD's cross-type "special" recipe, and it is the deep
end of the build loop — combination towers are the strongest structures in the game,
and every one is a multi-level project to assemble.

- **The recipe list is authoritative in `specs/towers.md`.** There are **twelve**
  combination towers, each with a fixed recipe (an exact multiset of base
  `(type, quality)` ingredients), a fixed stat block, and its own ability loadout.
  Do **not** duplicate that table here; `specs/towers.md` owns the recipes and the
  combo stats. As illustration only: the early **Static Web** folds a Scrap **Coil** +
  Scrap **Capacitor** + Scrap **Choke** into a chaining, slowing tower, while the apex
  **Aurora Lance** demands a Tesla-Prime **Choke** + Primed **Coil** + Primed
  **Discharge Rig**.
- **Ingredients come from the board.** A recipe's ingredients may be **candidates**
  placed this level **and/or existing permanent components** already on the yard, in any
  mix — as long as their `(type, quality)` multiset exactly satisfies a recipe **and
  includes the selected initiating candidate**. The inspector surfaces any recipe within
  reach and a **COMBINE → `<combo name>`** action (`specs/controls.md`).
- **It resolves at SEND, as the level's single harvest.** Choosing a recipe-combine sets
  this level's harvest (reversible until send, exactly like KEEP or a quality-combine —
  one harvest per level). When you **send the wave** it resolves: the **combination
  tower lands at the initiating candidate's footprint**, and **every consumed ingredient
  footprint hardens into an inert blocker** — wall-neutral, never opening a hole
  (`specs/board.md`), the same rule as a quality-combine.
- **It costs no Charge** — like every combine, the cost is paid in the rolls you fed it,
  not in money.
- **Combos are single-grade and terminal.** A combination tower has **no quality tier**
  (a fixed stat block, `specs/towers.md`); it **cannot** be quality-combined, cannot be
  fed into another recipe, and cannot be climbed further. It does still benefit from
  external buffs such as a Regulator's aura (`specs/towers.md`).
- **Assembling a combo is a multi-level project.** Because most recipes demand specific
  qualities — many call for **Primed (T4) or Tesla-Prime (T5)** ingredients, which are
  **combine-only** — you must first climb those ingredients up the quality ladder over
  several levels (refining the press, quality-combining matches), stage them on the
  board, and only then fire the recipe. The apex combos are late-game payoffs planned
  many waves ahead; this is the strategic ceiling of the game.

## UPGRADE QUALITY — the Refinement track

The other place kill income goes is **refining the press** so it rolls stronger gems —
the game's second progression axis beside combining.

- A run carries a **Refinement level `R`** on a six-rung track **R0 … R5** (starts at
  **R0**). Higher `R` biases the stamp's **quality** roll toward higher tiers; it does
  **not** change the uniform 12.5%-per-type roll, the stats, the combine recipes, or
  anything else.
- The build panel's **UPGRADE QUALITY** control (`specs/controls.md`, hotkey `U`) buys
  the next Refinement level for **Charge**. It is disabled at **R5** or when you cannot
  afford the next cost. Refinement is permanent for the run.

Quality odds by Refinement level (each row is a T1–T3 distribution that sums to 1.0;
**T4 and T5 are always 0 — Primed and Tesla-Prime come only from combining** —
**fixed**):

| R | Scrap T1 | Tuned T2 | Charged T3 | Primed T4 | Tesla T5 |
| --- | --- | --- | --- | --- | --- |
| **R0** | 1.00 | 0.00 | 0.00 | 0 | 0 |
| **R1** | 0.80 | 0.20 | 0.00 | 0 | 0 |
| **R2** | 0.62 | 0.32 | 0.06 | 0 | 0 |
| **R3** | 0.46 | 0.40 | 0.14 | 0 | 0 |
| **R4** | 0.32 | 0.44 | 0.24 | 0 | 0 |
| **R5** | 0.20 | 0.45 | 0.35 | 0 | 0 |

Refinement cost to reach each level (Charge, from the previous level) — **fixed**:

| Reach | R1 | R2 | R3 | R4 | R5 |
| --- | --- | --- | --- | --- | --- |
| **Cost** | 60 | 130 | 240 | 400 | 620 |

Refining and combining are complementary: refine so the press hands out more **Charged**
base rolls, then combine matched Charged into the **Primed** and **Tesla-Prime** carries
the press will never roll on its own.

## How the loop drives the maze

Every rock you place — harvested or not — **walls** its footprint, and a combine of
either kind keeps every consumed footprint walled (each hardens into a blocker), so the
only way to free a footprint is to **dismantle** a structure between waves
(`specs/towers.md`). So building always tends to **lengthen** the Load's route between
waypoints, never seal it (`specs/board.md`). Read the **next-wave
preview** (`specs/flow.md`), place your five rocks to both extend the maze and fish for a
good roll, take the one harvest that best answers the coming wave (`specs/enemies.md`) —
a keep, a quality-climb, or a combination tower — let the rest harden into blockers, and
spend banked Charge on UPGRADE QUALITY to lift your future rolls — then send. That
build-phase cycle, constrained by the 5-stamp allowance, the one-harvest rule, and the
never-seal rule, is the game.
