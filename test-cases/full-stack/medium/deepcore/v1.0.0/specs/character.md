# The prospector — movement, drilling, fuel, hull, and animation

This file defines the **character** you control: how they move, how they drill, how
**fuel** and **hull** work, and the full set of **animation states** the produced art
must cover. It refers to the world and its tiles (`specs/world.md`), the ore and
cargo (`specs/mining.md`), the hazards (`specs/hazards.md`), the upgrade tiers
(`specs/upgrades.md`), the controls (`specs/controls.md`), and the produced assets
(`specs/assets.md`). The numeric values here are **fixed**; implement them exactly,
except the **fuel tank / drill / hull** maxima, which `specs/upgrades.md` sets per
tier.

The prospector is a **suited miner character**, not a vehicle: a figure with a
handheld **drill** and a back-mounted **jetpack**, roughly the size of **one tile**
(a `48 x 48` cell), so it fits cleanly in the mine and drills the tile immediately
ahead of it. How believably it **moves and animates** is half of what this build is
judged on (`specs/overview.md`, `specs/assets.md`).

## Movement

The miner moves in the tile world under simple physics, at a fixed timestep
(`specs/controls.md`). Position is continuous (logical pixels), not snapped to tiles;
collision is against the tile grid.

- **Gravity / falling.** When there is empty tunnel below the miner, it **falls**,
  accelerating under gravity up to a terminal speed. Falling costs **no fuel** — going
  down is cheap, which is the whole point of the loop (`specs/overview.md`).
- **Jetpack thrust (up).** Holding **thrust** (`specs/controls.md`) fires the jetpack,
  pushing the miner **up** against gravity — a hover at partial hold, a climb at full
  hold. Thrust is the **only** way to gain height, and it **burns fuel** (below).
- **No ceiling above the surface.** The sky over the camp is **open and unbounded**:
  the miner can thrust straight up out of the mine and keep climbing as long as it has
  fuel. There is **nothing up there** to reach — climbing into the sky only **wastes
  fuel**, and when the jetpack lets up the miner **falls back down**, taking
  **hard-landing damage** if it slams in too fast (`specs/hazards.md`). Fuel is still
  spent, and hull damage still taken, **above** the surface exactly as below it; the
  miner is never held at a fixed height by an invisible lid.
- **Lateral movement.** Holding **left** or **right** moves the miner horizontally. On
  the ground this is a **walk**; in the air it is a lateral drift (with the jetpack
  trimming). Lateral movement in the air burns a little fuel; walking on solid ground
  is free.
- **Collision.** The miner cannot pass into a solid (unmined) tile, the bedrock
  border, or lava; it rests on top of solid tiles and is stopped by walls. It fits in
  a single tile, so a one-tile-wide tunnel is passable.

Movement speeds (logical px/s): **walk / lateral** `150`, **fall terminal** `420`,
**thrust (net climb at full hold)** `200`. Gravity `900 px/s^2`. These are the
reference feel; tune within a natural range but keep falling faster than climbing so
depth is easy to gain and expensive to undo.

## Drilling

Drilling is how the miner removes tiles and gathers ore and materials
(`specs/world.md`, `specs/mining.md`).

- **Directions: down, left, right — never up.** The miner drills the tile it is
  **moving into**: hold **down** to drill the tile it is standing on, **left/right** to
  drill the tile beside it. **You cannot drill up** — the ceiling is solid, so the only
  way to ascend is the jetpack through tunnels you already carved. This one-way-down
  rule is the heart of the fuel tension (`specs/overview.md`) and is **fixed**.
- **Only while standing on solid ground.** The miner drills **only when it is
  grounded** — resting on a solid tile. A **falling** miner does **not** drill:
  dropping through open tunnel, thrusting up, or hovering, no direction key starts a
  cut. In a vertical shaft you **fall freely** and only begin drilling once you have
  **landed**. Drilling never happens in mid-air, and the drill never bites empty space
  the miner has not yet reached.
- **Side drilling starts at the tile edge, not on the keypress.** Holding **left** or
  **right** first **moves** the miner across the tile it is standing in; the cut into
  the side tile begins **only once the miner is flush against it** (at the **edge** of
  its current tile). This leaves room to **move laterally** within any tunnel wider than
  the miner before committing to a dig — pressing sideways in the middle of a tile
  **walks**, it does not instantly drill. (So in a one-wide shaft, tapping left/right
  nudges the miner to the wall and only then drills, rather than drilling the instant
  the key is pressed.)
- **Down drilling descends tile by tile.** Holding **down** while grounded drills the
  tile underfoot; when it clears, the miner **steps down** onto the next tile and — if
  down is still held and that tile is minable — continues, digging a clean vertical
  shaft. With **open space** below, holding down does nothing special: the miner simply
  **falls** (gravity pulls it down) and does not drill until it lands again.
- **Drilling a tile** takes a **drill time** set by the tile's band **hardness**
  (`specs/world.md`) and the miner's **drill tier** (`specs/upgrades.md`); while
  drilling, the miner is braced against that tile and the drill animation plays
  (below). When the timer completes, the tile becomes an **empty tunnel**; an **ore
  vein** also drops its ore into cargo, and a **material node** its material
  (`specs/mining.md`).
- **Hardness vs drill tier.** Each tile has a hardness `1..4` (its band); each drill
  tier has a **power**. Drill time scales with `hardness / power` — a higher tier
  drills everything faster, and a tile whose hardness **exceeds** the drill's power
  drills **very slowly** (a soft gate, not a hard block), so reaching the deepstone
  and coreshell at a workable pace **requires** buying up the drill (`specs/upgrades.md`).
  The exact per-tier times are in `specs/upgrades.md`.
- **Gas.** Drilling into a **gas pocket** does not yield a tunnel cleanly — it
  **detonates** (`specs/hazards.md`).

## Fuel

**Fuel** is the jetpack's charge and the run's real clock. It is consumed by using
the jetpack and by being underground, and it is **replenished only by buying it** at
the surface **Fuel Depot** (`specs/world.md`, `specs/flow.md`) — never for free and
never automatically. Running out strands the miner (below).

- **Maximum fuel** is set by the **fuel tank tier** (`specs/upgrades.md`); the
  starting tank holds `100`.
- **Consumption rates:** jetpack **thrust** `9.0 fuel/s` while held (including
  thrusting up into the **sky** above the camp); **lateral drift in the air**
  `2.0 fuel/s`; a passive **life-support drain** `0.4 fuel/s` at all times while
  underground (below the surface); and **`1.0 fuel` per tile drilled**. Walking and
  standing still cost no fuel (on the surface or on any solid floor below).
- **Refuel.** Fuel does **not** refill on its own — not by returning to the surface,
  not by rising into the sky above it. You **buy** it with **Credits** at the **Fuel
  Depot** (`specs/world.md`, `specs/flow.md`), per unit, up to your current maximum.
  Coming home only gives you a **place to buy** more fuel, not free fuel.
- **Out of fuel.** If Fuel reaches `0` underground, the jetpack dies: the miner can no
  longer thrust and, with no way up, is **stranded** — this is a **death**
  (`specs/modes.md`): in **Standard** the miner drops its haul and respawns at the
  surface; in **Hardcore** the run ends. A **low-fuel warning** (the gauge turns to
  the alert color, plus an alarm cue, `specs/assets.md`) shows while Fuel is under
  **20%**, so running dry is always the player's own call, never a surprise.

## Hull

**Hull** is the miner's health. It is spent by hazards — which can strike **above** the
surface too (a hard landing on the camp floor still hurts, `specs/hazards.md`) — and is
**repaired only by paying for it** at the surface **Fuel Depot** (`specs/world.md`,
`specs/flow.md`).

- **Maximum hull** is set by the **hull tier** (`specs/upgrades.md`); the starting
  hull is `100`.
- **Damage** comes from a **gas explosion** (a chunk, `specs/hazards.md`), **lava
  contact** (a fast drain while touching, `specs/hazards.md`), a **hard landing** (a
  fall faster than a safe threshold deals impact damage scaled to the excess speed),
  and the **Core Sample detonation** (`specs/hazards.md`). A **low-hull warning**
  shows under **25%**.
- **Hull reaching `0`** destroys the miner — a **death** (`specs/modes.md`), handled
  exactly as running out of fuel is: Standard drops-and-respawns, Hardcore ends the
  run.
- **Repair.** Hull does **not** mend on its own. You **buy** repairs with **Credits**
  at the **Fuel Depot** (`specs/world.md`, `specs/flow.md`), per point of hull, up to
  your current maximum.

## Animation states — the headline

The miner is a **produced, animated character** (`specs/assets.md`); the game plays
the cycle that matches what the miner is doing, advancing frames on a timer so the
motion reads. Every state below must be covered by a produced sprite-sheet cycle and
shown at the right moment — a stiff, single-frame miner is a **failed build**
(`specs/overview.md`, `specs/assets.md`). The miner also **faces left or right** (its
sprite mirrors) to match its lateral direction.

- **Idle** — standing on solid ground, not acting: a small breathing / lamp-flicker
  loop so the miner is alive at rest.
- **Walk** — moving laterally on the ground: a walk cycle, facing the move direction.
- **Drill down** — braced and drilling the tile below: the drill bites downward, the
  body shakes with the cut.
- **Drill side** — braced and drilling the tile beside it: the drill bites sideways,
  facing that direction.
- **Jetpack ascend** — thrusting up (or hovering): the jetpack fires, the body rises,
  exhaust below (the exhaust plume is a produced particle effect, `specs/assets.md`).
- **Fall** — dropping through open tunnel with no thrust: a falling pose, arms/legs
  trailing.
- **Hurt** — the moment of taking damage (a gas blast, a lava touch, a hard landing):
  a brief flinch/recoil that reads clearly as "took a hit".
- **Out of fuel / slump** — stranded with the jetpack dead: a slumped, powerless pose,
  the fail-state read.

Keep the character's silhouette and facing consistent across the set so it always
reads as the same prospector, only doing a different thing.
