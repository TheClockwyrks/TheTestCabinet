# Thunderhead — Units: archetypes, rosters, and stations

This file defines the units a fleet is built from: the shared **archetypes**, which
of them each power fields (and which it lacks), and — the heart of the file — the
**possessable stations** aboard every unit. The stations are the **possession
contract**: the places a player can drop into and fly, and switch between
(`specs/command.md`). Each power's identity and its signature mechanic are in
`specs/factions.md`; the exact damage, armor, shield, health, and weapon numbers
are in `specs/combat.md`; how units enter the battle is in `specs/battle.md`; how
they move across the world is in `specs/command.md`.

Every power fields units from the **same** archetype set, in its own material and
color (`specs/overview.md`), but no power fields the whole set — the **gaps** are
part of the asymmetry (`specs/factions.md`).

## The three domains

Units belong to one of the three altitude bands (`specs/world.md`):

- **Surface** — capitals, escorts, and support ships cruise along the **cloud-top**,
  maneuvering on the horizontal plane at sea level. They can make a **shallow dive**
  just beneath the cloud-top to break contact, but cannot reach the deep murk; the
  rules and each power's dive limits are in `specs/command.md` (Geode reaches deepest
  and lingers longest; `specs/factions.md`).
- **Air** — fighters and bombers fly the **open sky** above the cloud line.
- **Murk** — the **submarine** is the murk-native unit: it dives into the deep cloud
  to hide and stalk (`specs/recon.md`).

## The flagship

Each fleet has exactly one **flagship** — its designated **command capital**, a
tougher, higher-value ship. Its loss ends the battle (`specs/battle.md`). The
flagship is not a separate archetype; it is a power's principal capital, marked as
the flagship:

- **Ironbound** — the **battleship**;
- **Meridian** — the **carrier**;
- **Geode** — the **dreadnought** (its battleship).

## The archetypes and their stations

For each archetype below: its role, its domain, and its **stations**. Every listed
station is **directly possessable** and, when not possessed, is run by the unit's AI
(`specs/command.md`). The **kinds** of station are fixed; where a bomber's turret
**count** is given as a range it is tunable, and the number of physical turrets and
mounts a ship carries is set in `specs/combat.md`.

**Steering is not a station.** Possessing a unit **always** gives you its
**movement** — `A`/`D` steer, `W`/`S` set speed, and a submarine also sets **depth**
— whatever station you are in, with the **mouse** looking and, at a weapon station,
aiming and firing; there is **no bridge station**. Order a unit to a destination and
it **auto-steers** there, until the moment you give any movement input, which drops
that autopilot into **manual** control. And manning one station **does not idle the
rest**: every weapon you are **not** controlling keeps **firing automatically** under
AI (manning the surface guns does not silence the anti-air). The full movement and
possession rules are in `specs/command.md`.

**A ship's guns are controlled by class, not one turret at a time.** A warship
carries many **turrets** and **mounts** around its hull, and each is **independently
simulated** — its own **firing arc**, its own **range**, its own **reload**, its own
intact-or-destroyed state, and, within a turret, **each barrel reloads
independently** (`specs/combat.md`). But the player does **not** man them one by one.
A ship's gunnery **stations are weapon classes** — *surface guns*, *anti-air*,
*torpedoes* — and possessing a class gives you a **single crosshair** that commands
**every turret of that class at once**: those that **bear** on your aim, are **in
range** of it, and are **loaded** fire; those that cannot are shown as such on the
crosshair. Crucially, a class spans guns of **different sizes and ranges**: the
**surface-guns** class holds both a battleship's heavy, long-ranged **main turrets**
and its lighter, short-ranged **secondary/side guns**, so aiming at a **distant**
target fires only the main guns (the secondaries show as out of range), while a
**close** target brings both to bear at once. The per-turret status read-out and the
firing and reload rules are in `specs/combat.md`. This is the **opposite** of a
**bomber**, whose defensive turrets **are** manned one at a time (below).

### Capitals

- **Battleship** — a heavy surface **gun platform**, the slowest and most heavily
  armed ship. Stations:
  - **Surface guns** — the anti-ship class; one crosshair commands **both** the heavy,
    long-ranged **main turrets** (the battleship's heavy artillery) and the lighter,
    short-ranged **secondary/side guns**, each firing only when the aim point is
    within its arc and range (above; `specs/combat.md`);
  - **Anti-air** — the rapid-fire AA class against aircraft;
  - **Damage-control** (**Ironbound only**) — direct the ship's crew to fight fires,
    patch breaches, and restore knocked-out stations (`specs/factions.md`,
    `specs/combat.md`).
- **Carrier** — a surface **air-operations** capital, lightly gunned, that fields and
  services the fleet's aircraft. Stations:
  - **Flight operations** — launch, recover, arm, and direct the air wing (the
    carrier's signature station; how aircraft are supplied is in `specs/battle.md`);
  - **Anti-air** — the carrier's AA class;
  - **Shield-projector** (**Meridian only**) — the Meridian support role rides on its
    carrier: this station projects the shield-reinforcement bubble over nearby allies
    (`specs/factions.md`).

### Escorts

- **Cruiser** — the workhorse surface **escort**: moderate guns, strong anti-air, the
  ship that screens the capitals. Stations: **Surface guns**; **Anti-air**.
- **Destroyer** — a **fast, light** surface escort built to screen, run down, and hunt
  submarines (**Meridian** and **Geode** only; the Ironbound field none). Stations:
  **Surface guns** — its light anti-ship guns; **Torpedoes** — the destroyer's
  ship-killing punch; **Anti-air**; **Sub-hunt** — the murk-sensing and
  depth-ordnance station used to find and kill submarines (`specs/recon.md`,
  `specs/combat.md`).

### Submersible

- **Submarine** — the **murk-native** stalker; one type per power. It dives into the
  deep cloud, runs silent, and kills with torpedoes; its **depth** and
  **silent-running** are part of its movement (`specs/command.md`). Stations:
  - **Sensors** — the murk-limited sensing station: listen, and raise the periscope
    to sight when near the cloud-top (`specs/recon.md`);
  - **Torpedo** — set the firing solution (bearing, range, lead) and fire
    (`specs/combat.md`).

### Aircraft

- **Fighter** — a single-seat **air-superiority** craft: the dogfighter and the
  escort/interceptor. It has **no station to switch between**: possessing it you
  **fly** it and **fire its guns** with the mouse — pure flight. (Meridian fighters
  carry **blink**; `specs/factions.md`.)
- **Bomber** — a multi-crew **strike** aircraft that carries ordnance (bombs and/or
  torpedoes) and defends itself with gun **turrets**. You **fly** it at all times; the
  stations you man are its bomb-aiming and its turrets. Each power fields **one**
  bomber class, set by its **turret count** — the more turrets, the richer the "man a
  gun, switch to the next as attackers pass" play. Stations:
  - **Bombardier** — release the aircraft's ordnance on the target
    (`specs/combat.md`);
  - **Gun turrets** — manned **one at a time**, the player switching between them
    (unlike a ship's guns):
    - **Light bomber** — **1–2** turrets (**Meridian**);
    - **Medium bomber** — **2–3** turrets (**Geode**);
    - **Heavy bomber** — **3–5** turrets (**Ironbound**) — the richest gunnery
      platform in the game.

### Support

Support is **faction-specific** (`specs/factions.md`) — each power expresses it
differently, and it is **not** a universal archetype:

- **Ironbound — repair tender** (a standalone surface ship). Stations: **Repair
  control** — dispatch damage-control crews to patch and repair nearby allied ships;
  **Anti-air**.
- **Meridian — no separate support ship.** Its support role is the **shield-projector**
  station aboard the **carrier** (above).
- **Geode — lodestar** (a standalone surface ship) — the projector of the **resonance
  web** (`specs/factions.md`). Stations: **Field control** — shape and focus the web,
  trading between regeneration and weapon overcharge for units inside it; **Resonance
  turrets** — its only self-defense.

## The roster — who fields what

Each power fields the archetypes marked below; a blank is a **deliberate gap**
(`specs/factions.md`). **F** marks the power's flagship capital.

| Archetype | Ironbound | Meridian | Geode |
| --- | --- | --- | --- |
| Battleship | **F** | — | **F** (dreadnought) |
| Carrier | ✓ | **F** | ✓ |
| Cruiser | ✓ | ✓ | ✓ |
| Destroyer | — | ✓ | ✓ |
| Submarine | ✓ | ✓ | ✓ |
| Fighter | ✓ | ✓ (blink) | ✓ |
| Bomber | Heavy (3–5) | Light (1–2) | Medium (2–3) |
| Support | Repair tender | (carrier station) | Lodestar |

Read together with `specs/factions.md`: the **Ironbound** are a slow, capital-heavy
**gun line** (battleship flagship, no destroyer, a heavy bomber); the **Meridian**
are a fast, **carrier-centered** air-and-precision fleet (carrier flagship, no
battleship, a light bomber, support folded into the carrier); the **Geode** field
the **fullest** roster (both capitals, a medium bomber, a standalone lodestar) but
stake every ship on the resonance web.

## Possession and stations — the contract

- **Possessing a unit gives you its movement, plus one station at a time.** Steering
  is **always** yours (above); on top of it you may **man one station** — a ship's
  weapon class, a bomber's single turret, or a special station — controlling it with
  the mouse, and switch freely among them or back to just steering (on a battleship:
  surface guns → anti-air → steer). There is **no bridge station**.
- **Ships fire by class; bombers are manned by turret.** A ship's gunnery stations
  are **weapon classes** — manning one commands all of that class's independently
  simulated turrets and barrels at once through a single crosshair (above;
  `specs/combat.md`). A **bomber's** defensive turrets are the exception, manned
  **one at a time**; a **fighter** has none.
- **Everything you are not manning keeps fighting.** Weapon classes and turrets you
  are not controlling **auto-fire** under AI, and a unit with **no** player aboard
  fights on under its standing orders — nothing you leave goes dark
  (`specs/command.md`).
- **Two granularities.** Switching **between units** and switching **between stations
  within a unit** are both first-class actions, defined in `specs/command.md`.

## Stats

This file fixes each unit's **role, domain, and station layout**. The exact
**health, armor, shield, speed, turn and climb rates, weapon damage, ranges, and
rates of fire** for every unit — and how they differ by power — are consolidated in
`specs/combat.md`, so that the numbers live in one place with the resolution rules
that use them.
