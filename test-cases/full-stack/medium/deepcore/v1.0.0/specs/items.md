# Field supplies — single-use items and the Core Sample jettison

This file defines the six single-use **field supply** items the player buys and carries,
the **jettison** of the unstable Core Sample, and the **ground item** it becomes. It
refers to the economy and buildings (`specs/flow.md`, `specs/world.md`), the miner's
fuel/hull and fall impact (`specs/character.md`, `specs/hazards.md`), the mine's tiles and
unbreakable stone (`specs/world.md`), the Supply Depot building (`specs/world.md`), the Core
Sample timer (`specs/hazards.md`), and saving (`specs/flow.md`). The numeric values here
are **fixed**; implement them exactly.

## The six field supplies

Field supplies are **single-use** items: bought with **Credits** and carried as a
**count** per type, each **use consumes one**. They are a **fourth Credits sink**
alongside fuel/repair, upgrades, and the rocket (`specs/flow.md`).

| # | Item | Price (Credits) | Effect |
| --- | --- | --- | --- |
| 1 | **Dynamite** | `150` | Clears a **3×3** block of tiles centered on the miner (blast radius `1` tile). |
| 2 | **Plastic Explosives** | `500` | Clears a **5×5** block centered on the miner (blast radius `2` tiles). |
| 3 | **Quantum Teleporter** | `250` | Warps the miner to the surface, dropping it in **above the camp** at a randomized height and downward velocity — a **risky** escape (a bad roll slams into the floor). |
| 4 | **Matter Transmitter** | `2000` | Warps the miner **safely** to the surface, standing on the camp floor at zero velocity — a **premium guaranteed** escape. |
| 5 | **Regenerative Nanobots** | `200` | Repairs **`60` hull**, capped at max hull. |
| 6 | **Emergency Fuel** | `150` | Refuels **`60` fuel**, capped at max fuel. |

### Explosives (Dynamite, Plastic Explosives)

Both explosives clear a square block centered on the miner's tile — Dynamite a **3×3**
(radius `1`), Plastic Explosives a **5×5** (radius `2`). Their behavior on the block:

- **Soil / rock / ore / lava AND unbreakable stone all clear to tunnel.** This is the
  **"blast through" the unbreakable stone** that `specs/world.md` foreshadows as "a later
  addition" — the explosives are that addition, so a boulder in the block is destroyed.
- **Ore in the blast is destroyed, not collected** — the explosives clear the block, they
  do not mine it into cargo.
- **A gas pocket in the block detonates** (`specs/hazards.md`) — and because the miner is
  at the blast's center, that detonation can **hurt or kill** them: the risk of blasting
  near hidden gas. Gas detonations can chain within the block.
- **Bedrock, material nodes, and the Core tile are immune** — never destroyed. Material
  nodes are single (`specs/world.md`), so an errant blast must never delete the only node
  and soft-lock the run.
- Explosives cost **no fuel**; the clear is **instant**.

### Teleporters (Quantum, Matter Transmitter)

Both return the miner to the surface, but with very different risk:

- **Quantum Teleporter** (cheap, risky) drops the miner in **above the camp floor** at a
  **randomized height** (`1`–`8` tiles) with a **randomized downward velocity** (`150`–`700`
  px/s), then lets normal physics carry it down. A good roll lands gently; a **bad roll
  slams into the camp floor at speed**, and the **normal fall impact** (`specs/hazards.md`)
  applies — which can **kill a low-hull miner**. The randomized height/velocity are a live
  player action, not part of the deterministic proof, so they need not be seed-reproducible.
- **Matter Transmitter** (premium, safe) places the miner **standing on the camp floor at
  zero velocity, with no impact** — a clean surfacing. It is **significantly more expensive**
  than the Quantum Teleporter (`2000` vs `250`): a guaranteed escape you pay for.

### Repair supplies (Nanobots, Emergency Fuel)

- **Regenerative Nanobots** repair a fixed **`60` hull** (capped at max hull), triggerable
  underground — a mid-dig patch when the depot is far above.
- **Emergency Fuel** refuels a fixed **`60` fuel** (capped at max fuel), triggerable
  underground — a reserve tank for a climb that would otherwise strand the miner.

Using either at full hull / full fuel is a harmless **no-op** (a note, and it is **not**
consumed).

## Buying field supplies — the Supply Depot

Field supplies are sold at their **own surface building**, the **Supply Depot**
(`specs/world.md`) — a **sixth building** dedicated to single-use supplies, separate from
the Upgrade Shop (which sells only the upgrade tracks, `specs/upgrades.md`). Its overlay
panel lists the six items, each with its **icon**, **price**, and the **count** the player
currently holds, with its **BUY** control **greyed out when unaffordable** (Credits never
go negative — `specs/flow.md`). Buying one deducts its price and increments its count.
This makes field supplies the **fourth Credits sink** (`specs/flow.md`).

## Using field supplies

During live in-mine play, items are used two ways — both call the **same** use logic:

- **Hotkeys `1`–`6`** use items 1–6 (the numbering above), during live play.
- The **inventory overlay** (`specs/mining.md`) gains a **"Field Supplies"** section
  listing each held item with its count and a **USE** button (mouse).

Every action is **mouse-operable** (the inventory USE buttons and the shop BUY buttons),
with the keyboard hotkeys as accelerators (`specs/controls.md`). Using an item you hold
**zero** of, or one that **cannot apply** (Nanobots/Emergency Fuel at full), is a harmless
**no-op** with a note.

Item **VFX and sounds reuse existing produced effects** — the explosives and the ground
detonation reuse the produced **gas-explosion / core-detonation** particle systems and an
existing explosion/impact sound (`specs/assets.md`); **no new produced asset is required**.
The small **item icons are drawn in code**, consistent with the in-code HUD chrome
(`specs/assets.md`).

## Jettisoning the Core Sample + ground items

The unstable **Core Sample** (`specs/hazards.md`) can be **jettisoned** — dropped onto the
miner's current tile as a **ground item** — so the player can drop it and move away before
it detonates rather than dying to its expiry.

- **Jettison control.** Pressing **`J`** during live play, or the **JETTISON** control in
  the HUD/inventory while carrying the Sample, **drops the Core Sample onto the miner's
  current tile as a ground item**. The **destabilization timer keeps running** on the
  dropped Sample (it belongs to the ground item now, not the satchel) — jettison does not
  pause or reset it.
- **Ground item.** A jettisoned Sample sits on its tile, rendered (reusing the core / material
  sprite or its code fallback) with the **visible countdown still shown**. A general
  **ground-items** representation backs this, even though the Core Sample is its only user
  today.
- **No re-pickup — it's a one-way discard.** A jettisoned Sample **cannot be picked back
  up**; walking back over it does nothing. Jettison is a **commitment**: you trade this
  Sample away to escape its blast, and if you still need one you must **drill another from
  the Core**. The **Core is inexhaustible** (`specs/mining.md`) — it is never consumed, so
  the player can **obtain more than one Core Sample over a run**, one at a time (a new one
  is only taken when none is currently live — none carried and none ticking on the
  ground).
- **Location-aware detonation.** When the timer expires:
  - while **carried**, it kills the miner **outright** (as `specs/hazards.md` today);
  - while **jettisoned**, it detonates **at its ground location** — a big produced
    core-detonation VFX either way — but its lethal blast only reaches a miner **within the
    blast radius** (`3` tiles). A miner who fled far enough **survives**, and the Sample is
    **destroyed** (return to the Core for a fresh one).
- **Saving stays blocked.** Saving is refused whenever the Core Sample's timer runs —
  **whether carried or jettisoned as a ground item** — so the timer is never frozen out by
  saving and quitting (`specs/flow.md`, `specs/hazards.md`). Ordinary **dropped ore** stays
  "lost" (unchanged, `specs/mining.md`) — dropped ore is not a pickupable ground item; the
  ground item concept is for the Core Sample here.
- **Death destroys it.** A death (any cause, either mode) destroys the Core Sample whether
  carried or jettisoned (`specs/hazards.md`, `specs/modes.md`).

Item **counts persist in the save** (`specs/flow.md`) so a resumed expedition keeps its
supplies; the Core Sample is **never** saved (saving is blocked while it is active).
