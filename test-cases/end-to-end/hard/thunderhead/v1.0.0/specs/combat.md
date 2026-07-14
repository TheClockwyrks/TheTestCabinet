# Thunderhead — Combat: weapons, gunnery, and damage

This file defines what happens when weapons fire and when units are hit: the
**gunnery** model shared by every warship, the **weapon families** and how they
differ by power, the **ordnance** of aircraft and submarines, **anti-air**, and the
**damage model** (armor, shields, resonance regeneration, and battle damage). It also
carries the per-unit **stats**, so the numbers live with the rules that use them. The
units and their stations are in `specs/units.md`; who controls them is in
`specs/command.md`; each power's identity is in `specs/factions.md`; what a unit can
see to shoot at is in `specs/recon.md`. All quantities are in the units of
`specs/overview.md` (world units, `u/s`, degrees, seconds); the numbers here are
**fixed** — implement them as written, and the built game is validated against
them.

## Ship gunnery — the shared model

A warship's guns are commanded by **class** through a single crosshair
(`specs/units.md`); underneath, each gun is independently simulated. This model
applies to every ship weapon class (surface guns, anti-air, torpedoes) and is the
signature of ship combat.

### Turrets, barrels, arcs, and range

- A ship carries a set of **turrets/mounts** for each class, each fixed at a position
  on the hull with its own **firing arc** (the angular sweep it can traverse and
  elevate through) and its own **maximum range**.
- A turret has one or more **barrels**. **Each barrel reloads on its own clock** — a
  three-barrel turret can have one barrel loaded and two reloading — so a turret is
  able to fire whenever **at least one** of its barrels is loaded.
- **Firing.** When the player fires the manned class at the crosshair, **every turret
  of that class that is (a) intact, (b) bearing** — the crosshair lies within its arc
  — **(c) in range** — the aim point is within its maximum range — **and (d) has a
  loaded barrel** fires at the aim point. Turrets that cannot meet all four do not
  fire.
- **Fire mode.** The player may fire in **salvo** (all ready barrels of all eligible
  turrets at once) or **ripple** (one ready barrel per eligible turret per trigger
  pull, walking through the barrels as they reload); the fire-mode control is in
  `specs/flow.md`.

### The per-turret status read-out

While a class is manned, the crosshair carries **one small indicator per turret** of
that class, arranged **around** the crosshair as a ring of dots — **main guns above**
it, **secondary guns below** — so the player reads the whole battery at a glance. The
indicators are **small and unlabeled** and must stay **unobtrusive**: a ring of dots
around the reticle, never a panel or a table of rows that blocks the view. Each dot
is one of:

- **green — ready:** intact, bearing on the crosshair, in range, and with a loaded
  barrel;
- **amber — reloading:** intact and eligible, but every barrel is mid-reload; the dot
  shows **reload progress as a clock-like radial sweep** (a wedge filling around the
  dot), not a linear bar;
- **red — unavailable:** the turret **cannot** contribute to this shot — it is
  **destroyed**, or the crosshair is **outside its arc**, or the aim point is
  **outside its range**.

This read-out is a hard requirement: a player manning the surface guns must be able
to see, per turret, whether it is ready, reloading (and how far along), or unable to
fire and why — without the read-out crowding the view.

### Ballistics

How a shell flies depends on the weapon family (below): an **arcing** shell must be
**led** and **ranged** and can be lobbed over terrain; a **flat, fast** shot needs
little lead and no ranging but cannot clear cover. Terrain **blocks direct fire**
(`specs/world.md`, `specs/recon.md`); only arcing fire reaches over it.

## Weapon families by power

Each power's guns resolve to its identity (`specs/factions.md`):

- **Ironbound — artillery + rapid-fire.**
  - **Artillery** (its surface main guns): heavy shells on a pronounced **gravity
    arc**, **slow** in flight, so the gunner **leads** and **ranges** the target;
    **long** range, large **splash** on impact, **low** rate of fire, **high** damage
    that **defeats armor**. Because it arcs, it can throw **indirect** fire over a
    ridge or island onto a target its line of sight does not reach — a reach unique to
    the Ironbound.
  - **Rapid-fire** (its secondaries and anti-air): **high** rate of fire, **low**
    precision, **short** range, wide **spread** — it fills the air with fire (flak)
    rather than placing a precise shot, and each hit is light.
- **Meridian — high-velocity guns.** Railgun-like shots with a very **fast**
  projectile: **not** instantaneous, but so fast that the gunner needs only a
  **slight** lead and the **drop** over distance is **small but real**. Flat, precise,
  and dependent on a clean **line of sight**; it **cannot** be lobbed over cover.
- **Geode — resonance beams.** Crystal-fed energy bolts that **chain** to a nearby
  second target (or wash a small area) on hit, and that **overcharge** — higher damage
  and rate — while the firing unit is inside an intact **resonance web**
  (`specs/factions.md`); outside the web they fire at their base value.

## Aircraft and submarine ordnance

- **Fighter guns** — forward-firing rapid guns with a **very fast** projectile and
  **short** range, for dogfighting and strafing; possessing a fighter aims them with
  the mouse while you fly (`specs/command.md`).
- **Bomber ordnance** (the **bombardier** station; `specs/units.md`):
  - **Bombs** — released to fall on a **gravity arc** onto surface targets; the
    bombardier judges the release. Heavy damage on a hit.
  - **Aerial torpedoes** — dropped to run **level and straight** through the air/murk
    toward a ship (below).
- **Bomber turrets** — defensive **rapid-fire** guns, manned **one at a time**
  (`specs/units.md`).
- **Torpedoes** (submarines, destroyers, and torpedo-carrying bombers): run in a
  **straight line** at their launch heading and altitude/depth at a fixed **run
  speed** to a maximum **range**, with an **arming distance** inside which they do not
  detonate; a hit deals **heavy** damage. The firing **solution** — bearing, range,
  and lead on a moving target — is set from the torpedo station (`specs/units.md`).
- **Depth ordnance** (the destroyer **sub-hunt** station; `specs/units.md`):
  charges dropped into the **murk** that detonate at a set depth with an **area**
  effect, to flush and kill diving submarines.

## Anti-air

Anti-air is the fleet's answer to aircraft:

- AA guns are **rapid-fire, low-precision**, **short-to-medium** range, and engage
  **aircraft** only; Ironbound AA bursts as **flak** with a small **area** effect.
- When not manned, a ship's AA **auto-fires** at hostile aircraft that come into range
  (`specs/command.md`); a player may man the AA class to concentrate it on a chosen
  threat. Massed AA is deadly; a lone mount is not.

## The damage model

Every unit has a **hull-health** pool; at **0** it is destroyed and falls as a wreck.
How damage reaches the hull differs by power (`specs/factions.md`).

### Defense paradigms

- **Ironbound — armor.** Incoming damage is **reduced** by the target's **armor**, and
  light hits on heavy armor may **deflect** for little or no damage — so **rapid-fire**
  barely troubles a battleship while **armor-piercing artillery** and **torpedoes**
  bite deep. No shields, no passive healing.
- **Meridian — shields.** A separate **shield** pool sits over the hull: damage
  depletes the **shield** first, and while the shield holds the **hull is untouched**.
  Once the shield **collapses**, the **thin** hull takes fire directly until the
  shield **regenerates** — which begins only after a short spell (`~4 s`)
  **without being hit**, then refills over time. A Meridian unit caught with its shield
  down is fragile.
- **Geode — resonance regeneration.** No shield; the crystalline hull **regenerates**
  over time **while inside an intact resonance web** (`specs/factions.md`), and does
  **not** regenerate outside it. Overcharged weapons and steady healing make a
  webbed Geode fleet relentless — until its lodestars die and the web collapses.

### Battle damage

Beyond the health pool, hits cause **localized** damage that the status read-out and
the ship's handling reflect:

- **Turrets/mounts destroyed.** A gun hit hard enough is **knocked out** — it shows
  **red** on the class read-out and no longer fires (above).
- **Stations disabled.** A hit can **disable** a station: an **engine** hit cuts
  **speed and maneuver**; a weapon-class **control** hit takes that class offline until
  restored.
- **Fires.** Heavy hits can start **fires** that deal **damage over time** and
  **spread** to adjacent sections; an unfought fire reaching a magazine can **cook
  off** for a large burst of damage.
- **Structural breaches.** Deep hits open **breaches** that cut **speed, lift, and
  maneuver** and **worsen slowly** over time if untended.

How battle damage is **recovered** is itself part of the asymmetry:

- **Ironbound** direct **damage-control crews** (the ship's damage-control station;
  `specs/units.md`) to **fight fires, patch breaches, and restore knocked-out
  turrets/stations** — a **finite** crew pool working **one job at a time**, so the
  commander must triage under fire.
- **Meridian** has **no crews**: it avoids battle damage by keeping its **shield** up,
  and once the shield is down and damage lands, it must **break contact** and let the
  shield regenerate rather than repair.
- **Geode** **regeneration** (in the web) slowly restores the **hull** and brings
  **disabled** stations back; a fully **destroyed** turret stays destroyed.

## Signature-mechanic numbers

These pin the mechanics defined in `specs/factions.md`:

- **Meridian shields.** Each unit carries a shield pool (see the stat table);
  regeneration begins `~4 s` after the last hit and refills the pool over `~8 s`. A
  down shield reads visibly different from a live one (`specs/overview.md`).
- **Meridian blink** (**aircraft only**): a single instantaneous jump of a fixed
  **short** distance along the craft's facing. A **fighter's** blink **charges in
  `~1 s`** with a **short** cooldown (a reflex move); a **bomber's** blink **charges
  in `~3–4 s`** with a **visible wind-up** and a **long** cooldown (a committed move).
  A blink may not place the craft inside terrain. Ships and submarines cannot blink.
- **Geode resonance web.** A lodestar projects a web out to a **radius** around
  itself; lodestars **relay** to one another and to friendly units within a **relay
  range** and a clear **line of sight** (a ridge between them breaks the relay;
  `specs/factions.md`). A unit inside the web **regenerates** its hull and
  **overcharges** its weapons (a damage/rate multiplier); outside it, neither. When
  the lodestars are destroyed, the web collapses and both effects end at once.

## Unit stats

Baseline stats **by archetype** are below; each power then modifies them to its
identity (following the table). Health is hull HP; "defense" is the power's paradigm;
speed is top speed in `u/s`; primary range is the main weapon's max range in world
units. All values are **fixed** — implement them as written.

| Archetype | Hull HP | Top speed (`u/s`) | Primary range | Notes |
| --- | --- | --- | --- | --- |
| Battleship | `8000` | `24` | `760` (artillery) | Heaviest guns and armor; the slowest |
| Carrier | `6000` | `30` | — (air wing) | Lightly gunned; fields aircraft |
| Cruiser | `3000` | `40` | `420` | The escort workhorse; strong AA |
| Destroyer | `1500` | `64` | `300` | Fast; torpedoes and sub-hunt |
| Submarine | `1200` | `28` | `440` (torpedo) | Murk-native; fragile if caught surfaced |
| Fighter | `150` | `260` | `150` (guns) | Air superiority |
| Bomber | `400`–`800` | `150`–`190` | ordnance | Heavier and slower the more turrets |
| Support | `2000` | `36` | self-defense only | Tender / carrier-station / lodestar |

Per-power modifiers (applied to the baseline):

- **Ironbound** — **+armor** and **+hull**, **−speed**; artillery + rapid-fire; the
  battleship is its flagship and its most armored ship.
- **Meridian** — **+shield** and **+speed**, **−hull**; high-velocity guns; aircraft
  blink; the carrier is its flagship (no battleship).
- **Geode** — **regeneration in web** in place of armor or shields, **moderate**
  speed, **best murk endurance**; resonance beams; the dreadnought is its flagship.

The **flagship** of each fleet (`specs/units.md`) carries a **larger hull pool** than
a standard ship of its class, so it can absorb a real assault before it falls and ends
the battle (`specs/battle.md`).
