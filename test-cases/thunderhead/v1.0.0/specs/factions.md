# Thunderhead — The powers: Ironbound, Meridian, Geode

This file defines the three powers a fleet belongs to: each one's identity, color,
and the axis on which it is **asymmetric**. The units each power fields, and the
stations aboard them, are in `specs/units.md`; the exact damage, armor, shield, and
regeneration numbers are in `specs/combat.md`; how each power reinforces is in
`specs/battle.md`. Colors are the faction rows of the palette in
`specs/overview.md`.

The three powers are genuinely **asymmetric** — not reskins of one fleet. They do
not differ by stat sliders on identical units; they differ in **how their units
endure, strike, move, and reinforce**, and in **which** units they field at all.
The build must express all three, because a match is one power against another
(including a **mirror** match of the same power on both sides), and each is
**player-selectable and AI-controlled** (`specs/battle.md`).

## What the powers share, and what differs

Every power fights with the same **archetypes** — the capital ships, escorts,
submersible, aircraft, and support unit defined in `specs/units.md` — across the
same three altitude bands (`specs/world.md`), under the same command and possession
model (`specs/command.md`). The **world is neutral**: it carries no power-specific
structures or resources (`specs/world.md`), and **allegiance** (whose unit it is)
is shown by the allied/hostile marker color, independent of power
(`specs/overview.md`).

What differs, power to power, is a **package**:

- a **material and color** it is drawn in;
- a **weapon paradigm** — how its guns resolve, and what terrain rewards them;
- a **defense-and-sustain paradigm** — how it soaks damage and recovers;
- a **mobility trait**;
- a **reinforcement style** (`specs/battle.md`);
- a **roster** — which archetypes it fields and which it lacks (`specs/units.md`);
- a **signature mechanic** that is the heart of playing it.

The three signature mechanics — Ironbound **damage control**, Meridian **shields
and blink**, Geode the **resonance web** — are defined below at the level of what
they *do*; `specs/combat.md` pins their numbers.

## The Ironbound

A low, industrial power of riveted iron, coal-smoke, and gunpowder. Its ships are
heavy, slow, and hard to kill, and they win by out-lasting and out-throwing a foe.

- **Look.** Drawn in **iron** and **iron-dark** with **brass/rust** accents and
  trailing **coal smoke**; a heavy, blunt, riveted silhouette.
- **Weapons.** Two families of **gunpowder** guns. Its **artillery** — heavy main
  guns like a warship's — fire **slow, arcing** shells at a **low rate**: hard-hitting
  but demanding real **lead** and ranging on a moving target, and because they
  **arc** they can throw **indirect** fire over a ridge or island onto something the
  gun's line of sight does not reach, a reach no other power has. Its **rapid-fire**
  guns are the opposite — **high rate of fire, low precision**, quantity over
  quality: they **fill the air** with fire rather than place a precise shot, and are
  the backbone of Ironbound **anti-air** (`specs/combat.md`).
- **Defense and sustain.** No shields and no passive healing: the Ironbound endures
  through thick **armor** and **damage-control crews** (its signature, below).
- **Mobility.** The slowest power — high mass, wide turns, ponderous climbs and
  dives. It does not chase; it holds and grinds.
- **Reinforcement.** A **foundry queue**: reinforcements are cheap and steady but
  slow to arrive — an attrition economy (`specs/battle.md`).
- **On the terrain.** Plays the relief for **cover**, hugging cloud-top lanes
  between islands and lobbing **indirect** fire over ridges from behind them,
  trading its slowness for a position a faster foe cannot easily flank
  (`specs/world.md`, `specs/recon.md`).
- **Roster.** A gun-line, capital-heavy fleet built around the **battleship**; it
  fields **no destroyer** (too fast for the doctrine) and only a **heavy bomber**,
  never a light one (`specs/units.md`).

**Signature — damage control.** Battle damage on an Ironbound ship is **localized
and lasting**: hits can start **fires**, tear **hull breaches**, and knock **stations
offline** (a turret jammed, an engine crippled). Left unattended these **worsen over
time** — fires spread, breaches drag the ship down — even after the shooting stops.
Each ship carries a finite pool of **damage-control crew** the commander directs to
**fight fires, patch breaches, and restore stations**, one job at a time; triaging
that crew under fire is the core of playing the Ironbound. Full rules and numbers
are in `specs/combat.md`; directing the crew from the bridge is in
`specs/command.md`.

## The Meridian

A high, elegant power of seamless white hulls and cyan energy. Its ships are few,
expensive, fast, and lethal, and they win by striking precisely and never being
where the return fire lands.

- **Look.** Drawn in **pearl-white** and **silver** with **cyan** energy trim;
  smooth, curved, seamless silhouettes.
- **Weapons.** **High-velocity guns** — railgun-like shots with a very **fast**
  projectile. They are **not** instantaneous: the shot travels, but so quickly that a
  gunner needs only a **slight** lead on a moving target and its **drop** over
  distance is **small but real** (`specs/combat.md`). The flat, fast trajectory
  rewards a clean **line of sight** — a Meridian shot placed on target connects
  almost at once — but cannot be **lobbed past cover** the way Ironbound artillery
  can.
- **Defense and sustain.** A regenerating **energy shield** (its signature, below)
  over a **thin hull** — formidable while the shield holds, fragile the moment it
  falls.
- **Mobility.** The **fastest** power — quick, agile ships, and aircraft that
  **blink** (its signature, below).
- **Reinforcement.** **Precise construction**: reinforcements are **expensive** and
  slow, few but high-quality — every loss hurts (`specs/battle.md`).
- **On the terrain.** Fights for the **high ground**: because its guns need a clean
  line of sight, a Meridian fleet seeks **vantage** — peaks and floating islands —
  to see and shoot first, and uses its speed and blink to slip across ridges and
  break contact when a shot is denied (`specs/world.md`, `specs/recon.md`).
- **Roster.** An air-and-precision fleet built around the **carrier**; it fields
  **no battleship** (its capital line is the carrier) and only a **light bomber**,
  never a heavy one (`specs/units.md`).

**Signature — shields and blink.** Every Meridian unit is wrapped in an **energy
shield** that absorbs damage down to the hull: while it holds, the hull is untouched;
once it **collapses**, the thin hull takes fire directly until the shield
**regenerates** after a short spell **out of fire**. There is no armor and no
damage-control to fall back on — a Meridian caught with its shield down is glass.
Separately, Meridian **aircraft** — and only aircraft — can **blink**: a single
instantaneous short-range jump. A **fighter's** blink **charges quickly** and is a
reflex evade or reposition in a dogfight; a **bomber's** blink **charges slowly**,
with a visible wind-up, and is a committed, telegraphed move. **Ships and
submersibles cannot blink.** Numbers are in `specs/combat.md` and `specs/units.md`.

## The Geode

A crystalline power that runs on **resonance**. Its ships heal what they do not lose
outright and strike harder while their network holds — and falter when it is broken.

- **Look.** Drawn in **amethyst** and **crystal-light** with a **resonant magenta**
  glow; faceted, crystalline silhouettes that brighten when powered.
- **Weapons.** **Resonance beams** — crystal-fed energy that can **chain** between
  or wash across nearby targets, and that **overcharge** (fire harder) while the
  unit is inside an intact web (below; `specs/combat.md`).
- **Defense and sustain.** Crystalline hulls with **no shields**; instead, units
  **regenerate** while inside the **resonance web** (its signature, below). Outside
  the web they are ordinary hulls — no healing.
- **Mobility.** **Moderate** speed on the surface, but the best **murk endurance**
  of the three: Geode units **dive deeper and linger longer** in the concealing
  cloud, using it as a place to heal out of sight (`specs/world.md`,
  `specs/recon.md`).
- **Reinforcement.** **Crystal growth**: reinforcements grow in, tied to the health
  of the network (`specs/battle.md`).
- **On the terrain.** Uses **deep-murk** valleys as regeneration sanctuaries and
  positions its **support ships** so the relief does not break the web's relays
  (below).
- **Roster.** The fullest and most **exotic** roster of the three — it fields the
  broad set of archetypes, including a **medium bomber** (where the others take only
  heavy or only light) — but every ship's strength is staked on the network below
  (`specs/units.md`).

**Signature — the resonance web.** Geode strength flows from a **web** projected by
its **support ships** (lodestars), **not** from anything placed on the map. Each
lodestar anchors a **resonance field**, and lodestars **relay** to one another and
to nearby friendly units, forming a single **moving web** that travels with the
fleet. A Geode unit **inside** the web **regenerates** its hull and **overcharges**
its weapons; a unit **outside** it does neither. The web is the power's strength and
its glass jaw: **destroy the lodestars and the web collapses**, cutting the whole
fleet's healing and overcharge at a stroke — so protecting your lodestars, and
hunting the enemy's, is the Geode matchup. The web relays along **line of sight**:
a ridge or island **between** two lodestars can **break** the relay, so the network
must be positioned against the relief — but it is carried entirely by the fleet's
**own ships**, and nothing power-specific is ever placed on the terrain. Radius,
relay range, and rates are in `specs/combat.md`; the lodestar's stations are in
`specs/units.md`.

## Balance and matchups

The three powers are meant to be **distinct but even** — each strong somewhere and
exposed somewhere else:

- the **Ironbound** endures anything and out-ranges with indirect fire, but is slow
  and can be outmaneuvered and cut off;
- the **Meridian** hits first, hardest, and fastest, but shatters the instant it is
  caught with shields down;
- the **Geode** heals and overcharges without end, but folds when its lodestars are
  hunted down.

The build must make **every** matchup playable and none dominant, including a
**mirror** match (the same power on both sides) — allegiance color
(`specs/overview.md`) is what tells the two fleets apart there. Neither the player's
power nor the enemy's is privileged; the enemy AI plays whichever power it is given
to that power's identity (`specs/command.md`, `specs/battle.md`).
