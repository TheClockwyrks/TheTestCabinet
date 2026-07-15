# Hazards — gas, lava, impact, and the unstable core

This file defines the underground dangers: **gas pockets**, **lava**, **fall
impact**, and the **unstable Core Sample** whose timer is the game's climax. It
refers to the world's bands and tiles (`specs/world.md`), the miner's hull and death
(`specs/character.md`, `specs/modes.md`), and the rocket (`specs/rocket.md`). The
numeric values here are **fixed**; implement them exactly. There are **no enemies** in
Deepcore — the mine itself is the adversary.

## Gas pockets

A **gas pocket** (`specs/world.md`) is a minable-looking tile filled with volatile
gas, appearing from the **rockbed** band down and denser with depth.

- **Drilling into a gas pocket detonates it.** Instead of a clean tunnel, the tile
  **explodes**: it deals a **hull hit** (`specs/character.md`) to the miner if the miner
  is adjacent, throws a produced **gas-explosion VFX** (`specs/assets.md`), and **knocks
  the miner back** a short distance (a hard shove away from the blast). The tile itself
  is cleared to tunnel by the blast.
- **Gas damage scales with depth.** The raw hit is `~20` hull where gas first appears
  (rockbed, `125 m`) and rises to `~119` at the Core (`480 m`) — the formula is
  `max(20, 20 + 0.28 × (depth_m − 125))`. The **radiator** (`specs/upgrades.md`) then
  cuts it by its effectiveness (`0%`–`80%`). So a rockbed pocket is a survivable tax on
  a starting hull, but a coreshell pocket near the Core is **near-lethal without hull
  and radiator investment** — the deep gas is what forces those tiers before the core
  run, exactly as in Motherload.
- Gas pockets read as a distinct, faintly glowing green tile, so an alert player can
  spot one before drilling into it and choose to route around — but a careless dig
  into deep rock will hit them. They are a **scaling hull tax on reckless digging**, not
  a puzzle.

## Lava

**Lava** (`specs/world.md`) appears from the **deepstone** band down and grows dense
in the coreshell, forming pools the miner must **route around**.

- Lava is **not minable** — no drill breaks it.
- **Touching lava drains hull fast**: `32 hull/s` while in contact, before the radiator
  (`specs/character.md`). The **radiator** (`specs/upgrades.md`) cuts this by its
  effectiveness, so a well-cooled miner (up to `80%`) takes only a fraction of the drain
  — but even then a **brush** is survivable and **sitting in it** is fatal. Dense
  coreshell lava with no radiator is deadly on contact. Contact throws a produced
  **lava-sizzle / ember VFX** and the hurt animation (`specs/assets.md`,
  `specs/character.md`).
- Lava does **not** flow or spread (it is static terrain), so the player can plan a
  route around a pool. Generation never fully seals the way down or the way to a
  material with an unbroken lava wall (`specs/world.md`) — there is always a diggable
  path through the surrounding rock.

## Fall impact

Falling is free (`specs/character.md`), but **landing too fast hurts**. A landing at a
speed above a **safe threshold** deals **impact hull damage scaled to the excess
speed** — a gentle touchdown is harmless, but plummeting the full depth of a long
shaft and slamming into the floor costs hull.

The safe threshold must be **generous**: ordinary movement never chips the hull. A
free-fall **drop of roughly three tiles or less lands under the threshold and does no
damage at all** — stepping off a ledge, hopping down a short step, or dropping down a
shaft you already carved is always safe, and the miner should *not* be taking a steady
tax of chip damage just for descending. Impact damage begins only past that leeway and
then **ramps up smoothly with the excess landing speed**, so it is a consequence of a
genuine long, un-feathered plunge, not of routine drops. Because the miner reaches
terminal speed only after several tiles of free-fall (`specs/character.md`), landing
speed keeps climbing well past the safe drop, so a real plunge lands measurably harder
than a short one — the impact model has room to scale instead of pinning to a flat
maximum after a tile or two.

Even a full terminal-velocity slam is **survivable** — on the order of a fifth of the
starting hull, never a one-hit kill — so the hazard shapes how you descend without
punishing every drop. This rewards feathering the jetpack over the last stretch of a
deep drop rather than free-falling into the floor, and makes the hull tier
(`specs/upgrades.md`) matter for how boldly you can plunge: an upgraded hull shrugs off
an impact that would sting a starting one. Impact throws the hurt animation and a small
dust VFX (`specs/assets.md`).

## The unstable Core Sample

At the bottom of the mine, in the **Core chamber** (`row 96`, `specs/world.md`), sits
the **Core Sample** — the last material the rocket needs (`specs/rocket.md`) and the
game's climax. Reaching it means drilling all the way through the coreshell's lava
gauntlet; the chamber itself is a small bedrock-walled pocket around the glowing core.

- **Extracting it starts a destabilization timer.** The moment you take the Core
  Sample, a **`90`-second countdown** begins, shown prominently (a countdown readout
  plus an escalating alarm, `specs/assets.md`, `specs/flow.md`). You must carry it up
  and **install the Ignition Core at the launch pad** (`specs/rocket.md`) before the
  timer runs out. The countdown does **not** pause — not at the surface, not in the
  shop — it runs until the Core is installed or it expires.
- **If the timer expires, the Core Sample detonates.** It is a violent explosion — a
  large produced **core-detonation VFX** (`specs/assets.md`) — that deals **lethal
  hull damage**, killing the miner outright (`specs/character.md`, `specs/modes.md`):
  in **Standard** the miner is dropped-and-respawned (and the Sample is **destroyed**,
  not dropped — you must return to the Core and extract a fresh one), and in
  **Hardcore** the run ends. The detonation is deliberately a real, dramatic death —
  the tension of the climb back is the whole point of the core run, and it replaces
  the boss fight the game deliberately omits.
- **Dying while carrying it destroys it** regardless of mode (`specs/mining.md`,
  `specs/modes.md`): the Core Sample never survives a death, so a failed core run
  always means going back down for another. Everything already **installed** on the
  rocket stays installed — the checklist is the durable progress.

The core run therefore demands **preparation**: enough fuel-tank and hull tiers to
survive the depth and make the ascent inside 90 seconds. There is no time to refuel or
dawdle on the way up, so the run is only attemptable once the economy has geared you
for it — the descent's natural finale.
