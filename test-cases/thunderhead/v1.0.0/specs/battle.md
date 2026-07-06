# Thunderhead — The battle: deployment, economy, and victory

This file defines the shape of a match: how the two fleets **deploy**, how a fleet
**reinforces** over the battle, how the fight **escalates**, and how it is **won or
lost**. The deploy screen that sets a battle up is in `specs/flow.md`; the world the
battle is fought over is in `specs/world.md`; the units and their costs are in
`specs/units.md` and `specs/combat.md`; the enemy is run by the AI (`specs/command.md`).
All numbers are **tunable defaults**.

## Setup

A battle is **one fleet against one**. From the deploy screen (`specs/flow.md`) the
player chooses **their power**, the **opposing power** (a chosen power or random,
including a **mirror** of their own), and the match is generated:

- A **world** is procedurally generated with two opposed **deployment zones**
  (`specs/world.md`).
- Each fleet begins with a **starting fleet** — a roster of units from its power
  (`specs/units.md`) including its **flagship** — deployed in its zone along the
  cloud-top.
- Each fleet begins with a starting pool of **requisition** (below).

## The economy — requisition and reinforcement

A fleet grows over the battle by spending **requisition**, its single resource:

- **Income.** Requisition accrues at a steady **income rate** over time (a baseline,
  tunable — for example `+10` per second). Income is the clock the battle escalates
  on (below).
- **Reinforcements.** The player spends requisition to **call reinforcements** — new
  units from `specs/units.md`, each with a **cost** — which arrive at the fleet's own
  **deployment-zone edge** after a **build/arrival delay** and then take orders like
  any unit (`specs/command.md`).
- **Per-power reinforcement style** (`specs/factions.md`):
  - **Ironbound** — a **foundry queue**: units are **cheap** and come **steadily**,
    but each takes **longer** to arrive — an attrition economy that floods the field
    over time.
  - **Meridian** — **precise construction**: units are **expensive** and **few**, and
    arrive slowly — every reinforcement is a real commitment, every loss costly.
  - **Geode** — **crystal growth**: reinforcement is tied to the **resonance
    network**, growing in **faster while the web is healthy** and faltering when it is
    broken (`specs/combat.md`).

## Aircraft supply

Aircraft are not built to the field like ships; they fly from **carriers**
(`specs/units.md`):

- A carrier holds a finite **air wing**. From its **flight-operations** station (or by
  order; `specs/command.md`) it **launches** fighters and bombers, and **recovers**
  them to **rearm and refuel**.
- Aircraft lost in battle are **replaced** on the carrier over time (drawing on
  requisition), so a carrier is a renewing source of air power for as long as it
  survives — making the enemy carrier a priority target.
- A fleet with **no** surviving carrier has **no** way to renew its air wing (the
  Ironbound and Geode still field their bombers and fighters through the carrier;
  `specs/units.md`).

## Escalation

A battle must build to a **decision**, not stall:

- As the battle runs, **income rises** (or reinforcement waves grow) on a gentle
  ramp, so both fleets can field **more** as time passes and an even fight is pushed
  toward a break rather than a permanent stalemate.
- The escalation is **symmetric** — it lifts both fleets the same — so it sets the
  battle's tempo without handing either side an advantage.

## Victory and defeat

The battle is decided by the **flagships** (`specs/units.md`):

- **Victory** — the **enemy flagship** is destroyed (its hull reaches `0`).
- **Defeat** — **your flagship** is destroyed.
- Because the flagship carries a **larger hull pool** than a normal ship of its class
  (`specs/combat.md`) and can be **screened**, protected, and repaired or regenerated
  to its power's paradigm, killing one is the object of the whole fight: you must cut
  through its fleet, or slip past it, to reach it — while keeping your own alive.

A fleet may lose every other unit and fight on while its flagship lives; it may also
be reduced to its flagship and still win by a desperate strike on the enemy's. The
result is shown on the end screen with the run's stats (`specs/flow.md`): the outcome,
the time taken, units lost and destroyed, and the flagships' final state.

## The opponent

The enemy fleet is commanded by an **AI admiral** that plays its assigned power to
that power's identity (`specs/factions.md`, `specs/command.md`): it scouts, screens
its flagship, commits reinforcements, and presses or withdraws. It must be a genuine
opponent — a fleet a competent player has to out-command, not a passive target — and
it must play **every** power, including in a mirror match.
