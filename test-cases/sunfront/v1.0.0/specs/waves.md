# Sunfront — Waves, spawning, and the Reliquary objective

This file defines the wave clock, how spawners emit units each wave, how units
move and pick targets at a high level (details in `specs/units.md`), and the
Reliquary objective with its Aegis. It refers to the geometry in
`specs/playfield.md` and the economy in `specs/economy.md`.

## The wave clock

Combat is paced by a repeating **wave clock**, shown as a countdown in the HUD:

- The **first wave** fires **`20 s`** after the match begins (a short opening
  window to place your first spawners while income accrues).
- **Every wave after** fires **`45 s`** after the previous one. The countdown
  resets to `45` on each wave.
- When the countdown reaches `0`, a **wave fires** for **both sides at once**: the
  wave number increments (starting at wave 1), the income rate rises by `+3` sol/s
  (`specs/economy.md`), and every spawner emits (below).

Building, upgrading, and selling happen **continuously in real time** — the wave
clock does not pause the game or the economy; it only marks when new units are
stamped out. A spawner built or upgraded between waves takes effect on the next
wave.

## Spawning a wave

When a wave fires, for each side:

- **Every spawner the side owns emits exactly one unit of its type**, at that
  spawner's current **level** (its units carry the level's HP/damage bonus and
  level marker, per `specs/economy.md`).
- Units appear at that side's **muster line** (`specs/playfield.md`: player at
  `x = 96`, enemy at `x = 1184`), distributed across the lane's vertical extent
  so a wave enters as a spread rank, not a single stack. Stagger their entry
  over a fraction of a second if it helps them separate.
- A side with **no spawners** emits nothing that wave (and is surely losing).

Emitted units immediately begin advancing and fighting per `specs/units.md`: they
travel toward the enemy base, acquire the nearest enemy they can damage, and stop
to fight when it is in range. Units from earlier waves that are still alive fight
on — the battlefield accumulates, and the **front line** drifts toward whichever
side is losing, which is the tug-of-war.

## The Reliquary and the Aegis

Each side owns one **Reliquary** standing on its half of the field
(`specs/playfield.md`): `900 HP`, slowly self-repairing when undamaged. It is a
tempo objective, not a wall.

When a side's Reliquary is **destroyed** (brought to `0 HP` by the enemy):

1. **The destroyer is paid `+700` sol** immediately (`specs/economy.md`) — a
   war chest that can fund a heavy follow-up.
2. **The losing side immediately spawns one `Aegis`** at its own base as a
   defender's-advantage guardian — the game's built-in comeback valve, punishing
   an over-commitment to the push that just felled the Reliquary.

The **Aegis** is **not buildable** and appears only this way. It is a giant
Duneforged **siege fortress on treads** — deliberately **much larger and far more
powerful than any buildable unit**, and rare enough (at most two ever exist in a
match, and usually only one) that it can afford this special behavior:

- **Bulk and armor.** `2200 HP`, **Heavy** armor, speed `40`. It is a colossal
  tracked fortress that dwarfs everything else on the field, drawn noticeably
  larger than any buildable unit.
- **It defends its own half only — it never crosses midfield.** Unlike every
  other unit, the Aegis does **not** march toward the enemy base. It patrols and
  repositions **only on its owner's half of the field** (the owner's side of the
  vertical centerline `x = 640`) and **must never cross the middle of the map**:
  it hunts the enemy units that have pushed across onto its side, holding the
  line while its owner recovers. With no enemy in reach on its half, it holds
  position near the front of its own half rather than advancing over the
  centerline. This is its defender's-advantage identity — it blunts the very push
  that felled the Reliquary without becoming an attacker of its own.
- **Independent multi-turret targeting — the only unit in the game with it.**
  Every other unit acquires and fires on a single target (`specs/units.md`); the
  Aegis fights with **three turrets that each acquire and fire on their own
  target**:
  - **Main turret** (the long forward cannon): a **Piercing** anti-armor gun,
    `48` damage, `1.5 s` cadence, range `130`. It targets the **nearest Heavy
    enemy first** (falling back to the nearest ground enemy if no Heavy is in
    range). It fires only within a **narrow cone straight ahead**, and **the
    Aegis rotates its hull to bring that target into the cone** — the main gun's
    target is what determines which way the whole fortress faces.
  - **Two side turrets** (one on each flank): each a lighter **Splash** gun,
    `18` damage (radius `35`), `1.0 s` cadence, range `90`. Each **independently
    targets the nearest enemy within an arc on its own side** of the fortress (the
    left turret covers the left flank, the right the right), **prioritizing Light
    enemies first**. They fire **opportunistically** — each traverses on its own
    and neither waits for nor steers the hull's facing, so the Aegis can grind its
    main gun onto a Heavy while both flanks mow down the swarm around it.
- It **fights on until it is destroyed** — it does not decay or time out. It
  holds its half until the enemy kills it outright; when it reaches `0 HP` it is
  removed with no bounty.
- **At most one Aegis per side, at most two in a match.** A side whose Reliquary
  is already destroyed cannot gain another Aegis (there is no second Reliquary to
  lose), so the comeback valve fires exactly once per side per match — at most
  two Aegi exist across the whole match (one per side), and since usually only
  one Reliquary falls, most matches ever see just a single Aegis active.

A Reliquary destroyed does **not** end the match; only razing the enemy **base**
does (`specs/flow.md`). But taking the enemy Reliquary — surviving the Aegis it
summons — is usually the decisive swing toward that base.
