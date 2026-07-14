# Holdfast — The threat director: raids, fire, cover, and the downed (signature)

This file defines the other signature system of Holdfast: the raids that make survival a
fight. An escalating **threat director** sends waves of hostiles onto the map; combat is
**ranged**, fought with cover; settlers who fall are **downed** and bleed out; and a
colony that loses everyone is lost. **Read this file carefully.** It builds on the tile
world in `specs/world.md`, the settlers in `specs/settlers.md` (who fight, are downed,
and die), the structures in `specs/economy.md` (walls for cover, turrets for defense),
and the day/night clock in `specs/time.md` (which biases when raids come). The survival
pressure it creates is made explicit in `specs/flow.md`.

## The threat director

Raids do not come at random: a **threat director** schedules them on an **escalating
curve**.

- **Timing.** Raids arrive on a timer measured in days/cycles (`specs/time.md`) — a
  first raid comes early enough to matter and later raids follow on a tightening
  interval, so the colony gets breathing room at the start and steadily less. Between
  raids the colony rebuilds, buries its dead, and prepares.
- **Escalation by wealth and age.** Each raid's **size and strength scale up** with the
  colony's **age** (days survived) and its **wealth** (a rough measure of what it has —
  settlers, structures, stocks, turrets). A colony that grows fat and old draws bigger
  raids; success makes the next fight harder. Tune the curve so a competent player can
  meet the early raids and is genuinely pressed by the later ones.
- **Announcement.** An incoming raid is **announced** before it lands — a prominent
  **threat/raid warning** on the HUD and the produced **raid-alarm** sound
  (`specs/flow.md`, `specs/assets.md`) — so the player has a moment to pull settlers to
  defensive positions, not a silent ambush.
- **Arrival.** Raiders enter from the map's walkable **edge spawn points**
  (`specs/world.md`), then advance toward the colony (its settlers, or its structures).
  Raids favor certain times of day (`specs/time.md`).

## Raiders

Raiders are hostile, autonomous attackers (drawn from their **produced sprite sheets**,
`specs/assets.md`, in the hostile color, `specs/overview.md`):

- Each raider **pathfinds** toward the colony (`specs/settlers.md`'s movement rules
  apply to them too) and **shoots** at settlers and turrets in range, taking cover like
  the settlers do (below). Raiders that reach melee range may strike directly (your
  choice).
- A raider reduced to zero health is **killed** (removed, with a blood/impact effect,
  `specs/assets.md`). When enough of a raid is killed the survivors may **break and
  flee** back off the map (your choice; a raid that fights to the last is also
  acceptable) — either way a **repelled raid ends** and the colony gets its respite.
- Raiders come for the colony: left unopposed they will kill settlers. The scale of a
  raid — and whether raiders also break the colony's walls to reach the settlers — is
  set by the playable start (`specs/mode.md`). They are the pressure the whole build
  exists to withstand.

## Ranged combat

Combat is **ranged** and resolved on the fixed simulation tick (`specs/controls.md`):

- **Shooting.** A shooter (an armed settler, a turret, or a raider) with a hostile
  target **in range and in line of sight** fires at it on a cadence, playing a
  **muzzle-flash** effect (`specs/assets.md`) and the **gunshot** sound
  (`specs/assets.md`). A shot has a **hit chance** — influenced by range, the shooter's
  **shooting skill** (`specs/settlers.md`), and the target's **cover** (below) — and a
  hit does **damage** to the target's health, throwing a **blood/impact** effect
  (`specs/assets.md`).
- **Line of sight.** A shot needs a clear line to its target; **walls block line of
  sight and fire** (`specs/economy.md`), so a walled colony can force raiders to expose
  themselves at a doorway or a gap. Model line of sight at least at tile granularity.
- **Turrets.** A **turret** (`specs/economy.md`) is an automated shooter: while built
  and intact it **acquires and fires at raiders in range on its own**, with no settler
  needed. Turrets are the colony's tireless defenders but cannot be everywhere; they can
  be **damaged and destroyed** by raiders (and, if you wish, need a settler to repair
  or reload — state it in the `README`).

## Cover

**Cover** is what makes positioning matter:

- A target **adjacent to or behind a wall** (or other cover-giving structure) relative
  to the shooter takes **reduced incoming hit chance** — the wall soaks part of the
  fire. A target caught in the open is hit far more easily.
- So the colony fights best from **behind its walls, shooting through a doorway or a
  firing slit**, while raiders in the open take the worse of the exchange — and the
  colony's job is to build the ground that way before the raid lands. Show cover's
  effect clearly enough that a player can see that fighting from behind a wall works and
  fighting in the open does not.

## Downed settlers and bleeding out

When a **settler** takes enough damage it does not simply vanish:

- **Downed.** A settler reduced to zero (or near-zero) health is **downed** — it drops,
  plays its **downed** animation (`specs/assets.md`), and can no longer work or fight. A
  downed settler is **out of the fight** but not yet dead.
- **Bleeding out.** A downed settler **bleeds out** over time and **dies** if not
  **tended** — another settler (a rescue/tend job, folded into the job system,
  `specs/settlers.md`) can reach it and stabilize/carry it to safety, saving its life.
  If no one can reach it before it bleeds out, it dies. You may keep tending simple
  (reach it and stabilize) — the point is that a downed colonist is a crisis the colony
  can sometimes save and sometimes cannot.
- A downed or dead colonist **drags mood down** across the colony (`specs/settlers.md`),
  so losing people costs more than the labor of one settler.

## When a raid takes the colony

Combat is how a colony most often ends. If a raid kills or downs-and-bleeds-out the
settlers faster than the colony can fight back, tend its wounded, and repel the attack,
the crew dwindles — and when the **last settler dies**, the colony is **lost**
(`specs/flow.md`). Standing up defenses — walls for cover, turrets for firepower, armed
and skilled shooters, and the food and rest to keep them fighting — before the raids
outgrow them is the whole game.
