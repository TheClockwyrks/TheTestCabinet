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

The **Aegis** is **not buildable** and appears only this way:

- Stats (`specs/units.md` roster notes): `1400 HP`, **Heavy** armor, **Splash**
  attack `34` (radius `50`), cadence `1.3 s`, range `70`, speed `42`. It advances
  and fights like any other unit, but toward the enemy — it is a heavy multi-gun
  siege fortress that grinds *out* on its treads from the base it defends.
- It is **temporary**: it loses **`40 HP/s`** continuously from the moment it
  spawns (so, undamaged, it expires in about `35 s`), and it can also be killed
  outright. When it reaches `0 HP` it is removed with no bounty.
- **At most one Aegis per side exists at a time.** A side whose Reliquary is
  already destroyed cannot gain another Aegis (there is no second Reliquary to
  lose), so the comeback valve fires exactly once per side per match.

A Reliquary destroyed does **not** end the match; only razing the enemy **base**
does (`specs/flow.md`). But taking the enemy Reliquary — surviving the Aegis it
summons — is usually the decisive swing toward that base.
