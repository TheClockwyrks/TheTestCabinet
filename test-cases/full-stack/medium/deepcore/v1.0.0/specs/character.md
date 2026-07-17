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
(an `80 x 80` cell), so it fits cleanly in the mine and drills the tile immediately
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
  hold. Thrust is the **only** way to gain height, and it **burns fuel** (below). How
  fast it climbs depends on the **load** it is lifting — see **Weight and lift** below.
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

Movement speeds (logical px/s, on the game's `80 px` tile): **walk / lateral** `250`,
**fall terminal** `1000`. Gravity `1500 px/s^2`. (These set the *feel in
tiles-per-second* — how many tiles a walk or a fall covers each second; tune within a
natural range.) The **climb** speed is not a single number: it
is capped per **jetpack tier** when **empty** (`700` at tier 1 rising to `940` at tier 5,
`specs/upgrades.md`) and,
more importantly, throttled down by the **load** (**Weight and lift**, below) — a heavy
haul is held to a much slower climb than an empty miner on the same jetpack. These are
target feel values; tune within a natural range but keep falling faster than climbing so
depth is easy to gain and expensive to undo. Terminal is high enough that a fall keeps
accelerating over several tiles before it caps, so **landing speed genuinely separates a
short hop from a full-depth plunge** — which is what makes fall impact (`specs/hazards.md`)
scale sensibly instead of maxing out after a tile or two.

## Weight and lift — the engine tension

Every unit of ore has a **weight** (`specs/mining.md`); the miner's **total mass** is its
own mass (`200 kg` — suit, drill, jetpack) plus the weight of the ore in the bay. The
jetpack pushes up with a fixed **lift force** set by the **jetpack tier**
(`specs/upgrades.md`); the upward **acceleration** it actually achieves is that force
divided by the total mass. So:

- A **heavier haul climbs slower** — and, because thrust is billed per second (below), a
  heavy climb burns **far more fuel** than a light one over the same shaft. Weight is
  what makes cargo a genuine cost, not just a number.
- Past a point, the load is **too heavy for the jetpack to lift at all**: when the thrust
  acceleration no longer exceeds gravity, holding thrust only **slows the descent** — the
  miner **cannot climb**. This is the Motherload "too heavy to take off" wall, and it is
  **fixed** behavior. The heaviest liftable load rises with the jetpack tier. Cargo is
  capped by **slot count**, not weight (`specs/mining.md`), so a bay full of **light**
  ore lifts easily while a bay part-filled with **heavy** deep ore can already exceed the
  jetpack's lift — weight, not the slot cap, is what strands a rich haul.
- **Drop ore to lift off.** Because an overloaded miner would otherwise be stranded (it
  cannot climb and cannot drill up), it can open the **inventory** at any time
  (`specs/mining.md`, `specs/controls.md`) and **drop specific ore** to lighten the load
  until it can lift off again. Dropped ore is **lost** (not sold), and the player chooses
  **which** ore to ditch. The HUD warns **OVERLOAD** while the load exceeds what the
  jetpack can lift (`specs/flow.md`).

The **jetpack (engine) tier** therefore matters as much as the fuel tank on a deep, rich
haul: a better jetpack mainly lifts **more weight** — the empty-load climb speed rises only
gently across tiers on purpose (`specs/upgrades.md`), so a jetpack tier is about *lifting a
heavier haul*, not flying ever faster — and the deep bands' heavy, valuable ore cannot be
brought up in bulk until it is bought up. Fuel efficiency comes from the **climb speed**
(the fuel bullet below): an **empty** miner cruises fast and sips fuel, while a **heavy**
haul is throttled to a slow climb and burns the full rate the whole way home.

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
- **Down drilling sinks smoothly, tile by tile.** Holding **down** while grounded drills
  the tile underfoot, and the miner **sinks smoothly into that tile as its health drains**,
  arriving flush on the next tile exactly as the one it was cutting breaks. So a held-down
  shaft reads as one **continuous bore** — the miner is never yanked a whole tile downward
  in a single frame (no teleport-snap); its descent stays glued to the drilling. It keeps
  going while down is held and the tile below is minable, digging a clean vertical shaft.
  With **open space** (or lava) below the tile being cut, the miner does **not** pre-sink:
  once that tile breaks it simply **falls** into the opening (gravity pulls it down) and
  does not drill again until it lands.
- **Tiles have health; the drill does damage.** Every minable tile has a **health** set by
  its band's **hardness** (`specs/world.md`): topsoil `4`, rockbed `8`, deepstone `12`,
  coreshell `16`. The drill deals **damage per hit** set by the miner's **drill tier**
  (`specs/upgrades.md`), landing hits on a fixed cadence; each hit **spends fuel** (below)
  and shaves the tile's health, and the tile **breaks** when its health reaches `0`. So the
  number of hits to break a tile is `ceil(health / damagePerHit)`, and a harder band takes
  **more hits — more time and more fuel** — unless the drill is bought up (`specs/upgrades.md`
  gives the per-tier damage and the resulting time and fuel per band). While drilling, the
  miner is braced against that tile and the drill animation plays (below).
- **Damage persists on the tile.** If the miner drills a tile partway and then **stops** —
  moves away, or runs low on fuel — the tile **keeps its accrued damage**, and the fuel
  already spent is **not refunded**: coming back and drilling it again **resumes from where
  it left off**, it does not restart from full health. The tile being cut shows a **damage
  overlay** — a produced crack sprite whose frame **deepens with the tile's damage**
  (`1 − health/maxHealth`: light hairlines early, a shattered face as it nears breaking) —
  and, because the damage persists, a partly-drilled tile **still shows its cracks** when
  the miner returns to it (`specs/assets.md`). When a tile breaks it becomes an **empty
  tunnel**; an **ore vein** also drops its ore into cargo, and a **material node** its
  material (`specs/mining.md`).
- **Unbreakable stone and bedrock never yield.** A drill aimed into an **unbreakable
  stone** boulder or the **bedrock** border does nothing — no cut starts, no damage
  overlay, no progress (`specs/world.md`). The miner must **route around** it: dig
  sideways and continue past, rather than straight through. This is the whole point of
  the stone — it bends a straight shaft.
- **Hardness vs drill tier.** Each tile's **health** rises with its band hardness `1..4`
  and each drill tier deals more **damage per hit**, so a higher tier breaks everything in
  fewer hits — less time **and** less fuel. A deep band on a weak drill takes many hits
  (slow, and fuel-hungry) — a soft gate, not a hard block — so reaching the deepstone and
  coreshell at a workable pace and fuel cost **requires** buying up the drill
  (`specs/upgrades.md`). The exact per-tier damage, hits, times, and fuel per band are in
  `specs/upgrades.md`.
- **Gas.** Drilling into a **gas pocket** does not yield a tunnel cleanly — it
  **detonates** (`specs/hazards.md`).

## Fuel

**Fuel** is the jetpack's charge and the run's real clock. It is consumed by using
the jetpack and by being underground, and it is **replenished only by buying it** at
the surface **Fuel Depot** (`specs/world.md`, `specs/flow.md`) — never for free and
never automatically. Running out strands the miner (below).

- **Maximum fuel** is set by the **fuel tank tier** (`specs/upgrades.md`); the
  starting tank holds `100`.
- **Consumption rates:** jetpack **thrust** burns **`6.0` fuel/s at the full rate,
  easing to `2.2` fuel/s once cruising** — the thrust burn is **not flat**: it depends on
  the miner's **upward climb speed**. Lifting off from a stop, or grinding up under a
  heavy load that can barely climb, burns the **full `6.0` fuel/s**; once the miner is
  **cruising at climb speed** — which an **empty or light** miner reaches quickly (its
  upward speed is above the cruise threshold) and a **near-overloaded** one never does —
  the burn eases toward **`2.2` fuel/s** (the rate interpolates between the two over the
  climb-speed range). This is what makes an **empty ascent cheap and fast** without simply
  raising the top climb speed: the efficiency comes from **cruising**, so a light haul
  flies home for a fraction of the fuel while a heavy one, throttled to a slow climb,
  keeps paying the full rate. (All thrust, including up into the **sky** above the camp,
  bills this way.) **Lateral drift in the air** is `2.0 fuel/s`; a passive **life-support
  drain** `0.4 fuel/s` at all times while underground (below the surface); and **`0.25
  fuel` per drill hit**, so drilling a tile costs `hits × 0.25` fuel — a **topsoil** tile
  at the tier-1 drill (4 hits) is `≈ 1.0` fuel (the old flat per-tile cost), and **harder
  bands cost more** (a coreshell tile is `4.0` fuel at tier 1) **unless the drill is
  upgraded**, which cuts the hits and so the fuel (`specs/upgrades.md`). Walking and
  standing still cost no fuel (on the surface or on any solid floor below).
- **Weight raises the fuel cost of the climb.** A heavy haul climbs slower (**Weight and
  lift**, above), and because a slow climb stays **below the cruise threshold** it burns
  the **full thrust rate** the whole way — so the same shaft costs **far more fuel** to
  ascend the heavier you are, both from the slower climb and from the lost cruise
  efficiency. A deep, rich, heavy haul is expensive to lift in jetpack tier **and** in
  fuel — factor it into whether the round trip fits the tank.
- **Refuel.** Fuel does **not** refill on its own — not by returning to the surface,
  not by rising into the sky above it. You **buy** it with **Credits** at the **Fuel
  Depot** (`specs/world.md`, `specs/flow.md`), per unit, up to your current maximum.
  Coming home only gives you a **place to buy** more fuel, not free fuel.
- **Out of fuel.** If Fuel reaches `0` underground, the jetpack dies: the miner can no
  longer thrust and, with no way up, is **stranded** — this is a **death**
  (`specs/modes.md`): the run ends at a summary screen, from which **Standard** lets the
  player **restore their last save** and **Hardcore** does not (permadeath). A
  **low-fuel warning** (the gauge turns to the alert color, plus an alarm cue,
  `specs/assets.md`) shows while Fuel is under **20%**, so running dry is always the
  player's own call, never a surprise.

## Hull

**Hull** is the miner's health. It is spent by hazards — which can strike **above** the
surface too (a hard landing on the camp floor still hurts, `specs/hazards.md`) — and is
**repaired only by paying for it** at the surface **Fuel Depot** (`specs/world.md`,
`specs/flow.md`).

- **Maximum hull** is set by the **hull tier** (`specs/upgrades.md`); the starting
  hull is `100`.
- **Damage** comes from a **gas explosion** (a chunk that **scales with depth**,
  `specs/hazards.md`), **lava contact** (a fast drain while touching, `specs/hazards.md`),
  a **hard landing** (a fall faster than a safe threshold deals impact damage scaled to
  the excess speed), and the **Core Sample detonation** (`specs/hazards.md`). A
  **low-hull warning** shows under **25%**.
- **The radiator reduces heat damage.** Gas-explosion and lava-contact damage are cut by
  the **radiator tier**'s effectiveness (`0%` at tier 1 up to `80%` at tier 5,
  `specs/upgrades.md`, `specs/hazards.md`). Because deep gas and dense coreshell lava
  scale up sharply, the **hull tier and the radiator tier together** are what make the
  deep bands and the core run survivable — hull alone is not enough down deep.
- **Hull reaching `0`** destroys the miner — a **death** (`specs/modes.md`), handled
  exactly as running out of fuel is: the run ends at a summary screen; Standard offers a
  restore from the last save, Hardcore is permadeath.
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
