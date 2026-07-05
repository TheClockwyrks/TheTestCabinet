# Thunderhead — Reconnaissance and the fog of war

This file defines what a fleet can **see**: detection by sight and by sensors, the
**fog of war** over the undetected enemy, and how the **murk** and the **terrain**
conceal. Detection decides what the tactical view shows (`specs/command.md`), what
weapons can engage (`specs/combat.md`), and it is the whole game of the **submarine**
(`specs/units.md`). Ranges are in world units (`specs/overview.md`) and are **tunable
defaults**.

## The fog of war

A fleet does **not** automatically see the whole battlespace. Enemy units are hidden
until **detected**, and only detected enemies appear on the tactical view and its
contacts/minimap (`specs/command.md`, `specs/flow.md`):

- An **undetected** enemy is not drawn and not on the minimap.
- A **detected** enemy is shown as a **contact** in the hostile marker color
  (`specs/overview.md`), at the position it was last seen.
- Detection is **continuous**: a contact that leaves every friendly unit's detection
  **fades** to a **last-known** mark that lingers briefly and then clears, rather than
  tracking the enemy through cover.
- **Identification** sharpens with detection quality: a firm, close detection shows
  the unit's **type and allegiance**; a faint or distant one (especially through the
  murk) may show only an **uncertain contact** until it is seen better.

Your **own** fleet is always fully visible to you.

## Sight

Every unit **sees** hostile units within its **sight range** along an **unobstructed
line of sight**:

- **Terrain blocks sight.** A ridge, peak, island, or floating island between a unit
  and a target **hides** the target (`specs/world.md`); a unit can break contact by
  putting terrain between itself and the enemy.
- **Height extends sight.** The **higher** a unit sits, the longer its open sightline
  over the relief — a peak, a floating island, or simply flying high is a commanding
  **vantage** (`specs/world.md`). A high scout sees far; a ship down among the islands
  sees only its lane.
- **The open sky is clear.** Above the cloud line, sight is **long**; the sky is the
  place from which the most is seen, which is why **scouting aircraft** matter.

## Sensors

Beyond the eye, units carry **sensors** that detect at range without a clean visual —
but they are **blocked by terrain** the same way sight is, and **degraded by the
murk** (below):

- A unit's **sensor range** typically **exceeds** its sight range but yields a
  **fainter** contact (an uncertain mark that firms up as it is seen).
- Some units are **dedicated** to detection: **scouting aircraft** sweep wide from
  altitude, a **submarine's sensors** listen through the murk (`specs/units.md`), and
  a **destroyer's sub-hunt** station searches the murk for submarines
  (`specs/units.md`).
- Sensors do **not** see through solid terrain: the relief shapes the sensor picture
  as much as the visual one.

## The murk

The **murk** — the dense cloud below the cloud line (`specs/world.md`) — is the
game's concealment:

- A unit **inside** the murk is **hard to detect from outside** it: sight and sensors
  **do not reach** far into the murk, so a unit that dives into deep cloud **drops off
  contact**.
- A unit inside the murk also **sees poorly** — its own sight and sensors are
  **short-ranged** in the cloud, so hiding is a trade: concealment for blindness.
- Crossing the cloud line is what changes this: rising to the **cloud-top** or the
  open sky restores long sight and makes the unit detectable again.

## Submarines and stealth

The submarine is built around this concealment (`specs/units.md`, `specs/factions.md`):

- A submerged submarine running **silent** (its silent-running movement state;
  `specs/command.md`) is **very hard to detect** — the stealth striker of the fleet.
- It **gives itself away** by acting: moving **fast**, **firing** torpedoes, or
  rising toward the cloud-top all raise its detectability; a patient, slow, deep
  submarine stays hidden.
- It is hunted by **destroyers** — the **sub-hunt** station searches the murk and
  drops depth ordnance (`specs/combat.md`) — and is exposed the moment it **surfaces**
  to attack a target it cannot reach from depth.
- **Geode** submarines endure the murk best, diving deeper and lingering longer
  (`specs/factions.md`).

## Detection and combat

Detection and fire are linked (`specs/combat.md`):

- A unit engages, and its guns auto-fire at, only targets its fleet has **detected**
  and that are in range; a hidden enemy cannot be targeted.
- Firing on an enemy that has not detected **you** is the reward for scouting and
  stealth — the first, unanswered salvo. Keeping the enemy flagship's fleet blind
  while finding it is the reconnaissance game a battle is won through.
